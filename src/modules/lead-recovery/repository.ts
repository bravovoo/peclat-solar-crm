import type {PoolClient} from 'pg';
import {database,transaction} from '@/server/db';
import {AccessError,requirePermission,type Actor} from '@/modules/auth/policy';
import {assertCommercialAssignee,commercialScope,commercialScopeParams} from '@/modules/commercial/scope';
import {getRecord} from '@/modules/crm/repository';
import {recoveryIsOpen,recoveryEligibleAt} from './schedule';
import {businessHoursSchema} from '@/modules/automations/domain';
import {recoveryConsentInput,recoveryFilters,recoveryOperationInput,recoverySettingsInput,type RecoveryFilters} from './domain';
import {assessLead,exclusionLabels,loadLeadFacts,loadRecoveryConfig,type LeadAssessment} from './eligibility';

type Db=Pick<PoolClient,'query'>;
const defaultHours=businessHoursSchema.parse({'1':{enabled:true,start:'10:00',end:'14:00'},'2':{enabled:true,start:'10:00',end:'14:00'},'3':{enabled:true,start:'10:00',end:'14:00'},'4':{enabled:true,start:'10:00',end:'14:00'},'5':{enabled:true,start:'10:00',end:'14:00'},'6':{enabled:true,start:'10:00',end:'14:00'},'7':{enabled:false,start:'10:00',end:'14:00'}});
const defaultStages=['new','contact','qualified','awaiting_bill','bill_received','analysis','sizing','budget','proposal','negotiation'];
function templateParameterCount(components:unknown,type:string){const values=typeof components==='string'?JSON.parse(components):components,component=Array.isArray(values)?values.find(item=>item&&typeof item==='object'&&String((item as {type?:unknown}).type).toUpperCase()===type):null,text=component&&typeof component==='object'?String((component as {text?:unknown}).text??''):'';return Math.max(0,...[...text.matchAll(/\{\{(\d+)\}\}/g)].map(match=>Number(match[1])));}
function read(actor:Actor){requirePermission(actor,'lead_recovery.read');}
function manage(actor:Actor){requirePermission(actor,'lead_recovery.manage');if(actor.role!=='admin')throw new AccessError(403,'Somente administradores podem configurar a recuperação de leads.');}
function operate(actor:Actor){requirePermission(actor,'lead_recovery.operate');}

export async function recoverySettings(actor:Actor){
 read(actor);const loaded=await loadRecoveryConfig(database(),actor.organizationId);
 if(loaded)return loaded;
 return {settings:{organization_id:actor.organizationId,enabled:false,include_uncontacted:false,timezone:'America/Sao_Paulo',business_hours:defaultHours,lead_stages:defaultStages,seller_ids:[],version:1,updated_by:actor.userId,created_at:null,updated_at:null},steps:[]};
}

export async function recoveryOptions(actor:Actor){
 read(actor);const [templates,owners]=await Promise.all([
  database().query("SELECT id,name,language,category,status,supported,synced_at,components FROM whatsapp_templates WHERE organization_id=$1 AND status='APPROVED' AND supported ORDER BY name,language",[actor.organizationId]),
  database().query(`SELECT m.user_id id,u.name,m.role_code FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.active AND u.active AND m.role_code IN ('admin','manager','seller') ORDER BY u.name`,[actor.organizationId]),
 ]);return {templates:templates.rows.map(template=>({...template,header_count:templateParameterCount(template.components,'HEADER'),body_count:templateParameterCount(template.components,'BODY'),components:undefined})),owners:owners.rows};
}

export async function saveRecoverySettings(actor:Actor,input:unknown){
 manage(actor);const data=recoverySettingsInput.parse(input);
 return transaction(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[actor.organizationId]);
  const current=await db.query<{version:number}>('SELECT version FROM organization_lead_recovery_settings WHERE organization_id=$1 FOR UPDATE',[actor.organizationId]);
  if((current.rowCount&&Number(current.rows[0].version)!==data.version)||(!current.rowCount&&data.version!==1))throw new AccessError(409,'A configuração foi atualizada. Recarregue a página.');
  const templateIds=data.steps.map(step=>step.template_id),templates=await db.query<{id:string;components:unknown}>("SELECT id,components FROM whatsapp_templates WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND status='APPROVED' AND supported",[actor.organizationId,templateIds]);
  if(templates.rowCount!==new Set(templateIds).size)throw new AccessError(400,'Selecione somente modelos aprovados e suportados desta organização.');
  for(const step of data.steps){const template=templates.rows.find(row=>row.id===step.template_id);if(!template||step.header_parameters.length!==templateParameterCount(template.components,'HEADER')||step.body_parameters.length!==templateParameterCount(template.components,'BODY'))throw new AccessError(400,`Preencha os parâmetros exigidos pela tentativa ${step.position}.`);}
  for(const seller of data.seller_ids)await assertCommercialAssignee(actor,seller,db);
  if(data.enabled){
   const integration=await db.query("SELECT 1 FROM whatsapp_integrations WHERE organization_id=$1 AND status='connected'",[actor.organizationId]);
   if(!integration.rowCount)throw new AccessError(409,'Conecte o WhatsApp Business antes de ativar a recuperação.');
   const global=await db.query<{whatsapp_outbound_enabled:boolean}>('SELECT whatsapp_outbound_enabled FROM organization_automation_settings WHERE organization_id=$1',[actor.organizationId]);
   if(!global.rows[0]?.whatsapp_outbound_enabled)throw new AccessError(409,'Ative primeiro o envio externo automático nas configurações de Automações.');
  }
  await db.query(`INSERT INTO organization_lead_recovery_settings(organization_id,enabled,include_uncontacted,timezone,business_hours,lead_stages,seller_ids,updated_by)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(organization_id) DO UPDATE SET enabled=EXCLUDED.enabled,include_uncontacted=EXCLUDED.include_uncontacted,timezone=EXCLUDED.timezone,business_hours=EXCLUDED.business_hours,lead_stages=EXCLUDED.lead_stages,seller_ids=EXCLUDED.seller_ids,updated_by=EXCLUDED.updated_by,version=organization_lead_recovery_settings.version+1,updated_at=now()`,[actor.organizationId,data.enabled,data.include_uncontacted,data.timezone,JSON.stringify(data.business_hours),data.lead_stages,data.seller_ids,actor.userId]);
  await db.query('DELETE FROM lead_recovery_steps WHERE organization_id=$1',[actor.organizationId]);
  for(const step of data.steps)await db.query('INSERT INTO lead_recovery_steps(organization_id,position,delay_days,template_id,header_parameters,body_parameters) VALUES ($1,$2,$3,$4,$5,$6)',[actor.organizationId,step.position,step.delay_days,step.template_id,JSON.stringify(step.header_parameters),JSON.stringify(step.body_parameters)]);
  if(!data.enabled){await db.query("UPDATE lead_recovery_enrollments SET status='paused',state_reason='organization_disabled',version=version+1,updated_by=$2,updated_at=now() WHERE organization_id=$1 AND status='scheduled'",[actor.organizationId,actor.userId]);await db.query("UPDATE lead_recovery_attempts SET status='cancelled',completed_at=now(),safe_error='organization_disabled',updated_at=now() WHERE organization_id=$1 AND status IN ('pending','processing')",[actor.organizationId]);}
  else {await db.query("UPDATE lead_recovery_enrollments SET status='scheduled',state_reason='organization_enabled',version=version+1,updated_by=$2,updated_at=now() WHERE organization_id=$1 AND status='paused' AND state_reason='organization_disabled'",[actor.organizationId,actor.userId]);await db.query("UPDATE lead_recovery_attempts a SET status='pending',scheduled_for=GREATEST(a.scheduled_for,now()),completed_at=NULL,safe_error='',updated_at=now() FROM lead_recovery_enrollments e WHERE a.organization_id=$1 AND a.organization_id=e.organization_id AND a.enrollment_id=e.id AND e.status='scheduled' AND e.state_reason='organization_enabled' AND a.status='cancelled' AND a.safe_error='organization_disabled'",[actor.organizationId]);}
  await db.query("INSERT INTO audit_logs(organization_id,actor_id,action,detail) VALUES ($1,$2,'lead_recovery.settings_updated',$3)",[actor.organizationId,actor.userId,`Recuperação ${data.enabled?'ativada':'desativada'}; ${data.steps.length} tentativa(s).`]);
  return loadRecoveryConfig(db,actor.organizationId);
 });
}

function applyFilters(items:LeadAssessment[],filters:RecoveryFilters){return items.filter(item=>{
 if(filters.q&&!`${item.name} ${item.owner_name}`.toLocaleLowerCase('pt-BR').includes(filters.q.toLocaleLowerCase('pt-BR')))return false;
 if(filters.owner_id&&item.owner_id!==filters.owner_id)return false;if(filters.stage&&item.stage!==filters.stage)return false;if(filters.inactivity_days&&item.inactivity_days<filters.inactivity_days)return false;
 if(filters.status==='eligible'&&!item.eligible)return false;if(filters.status==='excluded'&&item.eligible)return false;if(!['all','eligible','excluded'].includes(filters.status)&&(item.enrollment_status??'')!==filters.status)return false;return true;
 });}

export async function recoveryDashboard(actor:Actor,input:unknown={}){
 read(actor);const filters=recoveryFilters.parse(input),loaded=await loadRecoveryConfig(database(),actor.organizationId),facts=await loadLeadFacts(database(),actor.organizationId,actor,1000);
 const items=loaded?facts.map(fact=>assessLead(fact,loaded.settings,loaded.steps)):facts.map(fact=>({...fact,classification:null,eligible:false,reason:'missing_template',reason_label:'Recuperação ainda não configurada',inactivity_anchor:null,scheduled_for:null,inactivity_days:0,normalized_phone:null} as LeadAssessment));
 const filtered=applyFilters(items,filters),offset=(filters.page-1)*filters.page_size,metrics={inactive:items.filter(item=>item.eligible).length,scheduled:items.filter(item=>item.enrollment_status==='scheduled').length,sent:0,responded:items.filter(item=>item.enrollment_status==='responded').length,unanswered:items.filter(item=>item.enrollment_status==='scheduled'&&Number(item.attempt_count)>0).length,suspended:items.filter(item=>item.enrollment_status==='paused'||['opted_out','contact_blocked','conversation_paused'].includes(item.reason)).length,errors:items.filter(item=>item.enrollment_status==='error').length};
 const sent=await database().query<{total:number}>("SELECT count(*)::int total FROM lead_recovery_attempts WHERE organization_id=$1 AND status='sent'",[actor.organizationId]);metrics.sent=Number(sent.rows[0].total);
 return {items:filtered.slice(offset,offset+filters.page_size),total:filtered.length,page:filters.page,pageSize:filters.page_size,metrics,reasons:exclusionLabels};
}

export async function simulateRecovery(actor:Actor,now=new Date()){
 read(actor);const loaded=await loadRecoveryConfig(database(),actor.organizationId),data=await recoveryDashboard(actor,{page_size:100,status:'all'});
 const summary={analyzed:0,awaiting_company:0,awaiting_customer:0,due_d2:0,due_d5:0,due_d7:0,due_d10:0,blocked_consent:0,blocked_inactive:0,blocked_hours:0,completed:0,cancelled_inbound:0};
 let afterId:string|undefined;
 for(;;){const facts=await loadLeadFacts(database(),actor.organizationId,actor,100,undefined,afterId,now);if(!facts.length)break;
  for(const f of facts){summary.analyzed++;const inbound=f.last_inbound_at?new Date(f.last_inbound_at).getTime():0,outbound=f.last_manual_outbound_at?new Date(f.last_manual_outbound_at).getTime():0;
   if(inbound&&inbound>=outbound)summary.awaiting_company++;
   if(outbound>inbound)summary.awaiting_customer++;
   if(f.consent_status!=='opted_in'||!f.consent_source.trim())summary.blocked_consent++;
   if(f.status!=='active'||!f.owner_active)summary.blocked_inactive++;
   if(loaded&&!recoveryIsOpen(loaded.settings.business_hours,now))summary.blocked_hours++;
   if(f.enrollment_status==='completed')summary.completed++;
   if(f.enrollment_status==='responded'||f.state_reason==='client_replied')summary.cancelled_inbound++;
   if(loaded){const assessment=assessLead(f,loaded.settings,loaded.steps,now);if(assessment.eligible&&assessment.inactivity_anchor)for(const days of [2,5,7,10] as const){const step=loaded.steps.find(s=>s.delay_days===days);if(step&&(!f.enrollment_anchor_message_id||f.enrollment_anchor_message_id!==f.anchor_message_id||Number(f.attempt_count)<step.position)&&recoveryEligibleAt(assessment.inactivity_anchor,days)<=now)summary[`due_d${days}`]++;}}
  }
  afterId=facts.at(-1)!.id;if(facts.length<100)break;
 }
 return {simulation:true,external_actions_executed:false,generated_at:now.toISOString(),...data,summary};
}

export async function saveRecoveryConsent(actor:Actor,recordId:string,input:unknown){
 operate(actor);const data=recoveryConsentInput.parse(input);await getRecord(actor,recordId);
 return transaction(async db=>{await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[actor.organizationId]);const current=await db.query<{version:number}>('SELECT version FROM crm_contact_preferences WHERE organization_id=$1 AND record_id=$2 FOR UPDATE',[actor.organizationId,recordId]);if(current.rowCount&&Number(current.rows[0].version)!==data.version||!current.rowCount&&data.version!==null)throw new AccessError(409,'A preferência de contato foi atualizada. Recarregue a página.');
  await db.query(`INSERT INTO crm_contact_preferences(organization_id,record_id,whatsapp_consent_status,consent_source,consented_at,opted_out_at,updated_by) VALUES ($1,$2,'opted_out','Descadastramento registrado no CRM',NULL,now(),$3)
   ON CONFLICT(organization_id,record_id) DO UPDATE SET whatsapp_consent_status='opted_out',opted_out_at=now(),updated_by=EXCLUDED.updated_by,version=crm_contact_preferences.version+1,updated_at=now()`,[actor.organizationId,recordId,actor.userId]);
  await db.query("UPDATE lead_recovery_enrollments SET status='cancelled',state_reason='opted_out',version=version+1,updated_by=$3,updated_at=now() WHERE organization_id=$1 AND record_id=$2 AND status IN ('scheduled','paused')",[actor.organizationId,recordId,actor.userId]);await db.query("UPDATE lead_recovery_attempts a SET status='cancelled',safe_error='opted_out',completed_at=now(),updated_at=now() FROM lead_recovery_enrollments e WHERE a.organization_id=$1 AND e.record_id=$2 AND a.organization_id=e.organization_id AND a.enrollment_id=e.id AND a.status='pending'",[actor.organizationId,recordId]);
  await db.query("INSERT INTO audit_logs(organization_id,actor_id,action,detail) VALUES ($1,$2,'lead_recovery.opted_out',$3)",[actor.organizationId,actor.userId,`Descadastramento registrado para lead ${recordId}.`]);return (await db.query('SELECT * FROM crm_contact_preferences WHERE organization_id=$1 AND record_id=$2',[actor.organizationId,recordId])).rows[0];});
}

async function scopedEnrollment(db:Db,actor:Actor,id:string,lock=false){const params=commercialScopeParams(actor);params.push(id);const result=await db.query(`SELECT e.* FROM lead_recovery_enrollments e JOIN crm_records r ON r.organization_id=e.organization_id AND r.id=e.record_id WHERE ${commercialScope(actor,'r',true)} AND e.id=$${params.length}${lock?' FOR UPDATE OF e':''}`,params);if(!result.rowCount)throw new AccessError(404,'Acompanhamento não encontrado.');return result.rows[0];}
export async function operateRecovery(actor:Actor,id:string,input:unknown){operate(actor);const data=recoveryOperationInput.parse(input);return transaction(async db=>{await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[actor.organizationId]);const current=await scopedEnrollment(db,actor,id,true);if(Number(current.version)!==data.version)throw new AccessError(409,'O acompanhamento foi atualizado. Recarregue a página.');if(!['scheduled','paused'].includes(current.status))throw new AccessError(409,'Este ciclo já foi encerrado. Uma nova mensagem da empresa poderá iniciar outro ciclo.');let status=current.status,next=current.next_attempt_at;const reason=data.action;if(data.action==='pause')status='paused';else if(data.action==='cancel')status='cancelled';else if(data.action==='resume'){status='scheduled';next=new Date().toISOString();}else{status='scheduled';next=data.scheduled_for;}
 await db.query('UPDATE lead_recovery_enrollments SET status=$3,next_attempt_at=$4,state_reason=$5,version=version+1,updated_by=$6,updated_at=now() WHERE organization_id=$1 AND id=$2',[actor.organizationId,id,status,next,reason,actor.userId]);
 if(status==='cancelled'||status==='paused')await db.query("UPDATE lead_recovery_attempts SET status='cancelled',safe_error=$3,completed_at=now(),updated_at=now() WHERE organization_id=$1 AND enrollment_id=$2 AND status IN ('pending','processing')",[actor.organizationId,id,reason]);
 if(status==='scheduled')await db.query("UPDATE lead_recovery_attempts SET status='pending',scheduled_for=$3,safe_error='',completed_at=NULL,updated_at=now() WHERE organization_id=$1 AND enrollment_id=$2 AND status='cancelled' AND step_position=$4",[actor.organizationId,id,next,Number(current.attempt_count)+1]);
 await db.query("INSERT INTO audit_logs(organization_id,actor_id,action,detail) VALUES ($1,$2,'lead_recovery.operated',$3)",[actor.organizationId,actor.userId,`Acompanhamento ${id}; ação ${data.action}.`]);return scopedEnrollment(db,actor,id);});}

export async function recoveryForRecord(actor:Actor,recordId:string){read(actor);await getRecord(actor,recordId);const [preference,enrollment]=await Promise.all([database().query('SELECT * FROM crm_contact_preferences WHERE organization_id=$1 AND record_id=$2',[actor.organizationId,recordId]),database().query('SELECT * FROM lead_recovery_enrollments WHERE organization_id=$1 AND record_id=$2 ORDER BY created_at DESC LIMIT 1',[actor.organizationId,recordId])]);const history=(await database().query(`SELECT a.*,e.inactivity_anchor,e.status cycle_status,e.state_reason,e.sequence_snapshot->'steps'->(a.step_position-1)->>'template_name' template_name,m.meta_message_id,m.delivery_status,m.failure_code FROM lead_recovery_attempts a JOIN lead_recovery_enrollments e ON e.organization_id=a.organization_id AND e.id=a.enrollment_id LEFT JOIN whatsapp_messages m ON m.organization_id=a.organization_id AND m.lead_recovery_attempt_id=a.id WHERE a.organization_id=$1 AND e.record_id=$2 ORDER BY e.created_at DESC,a.step_position LIMIT 100`,[actor.organizationId,recordId])).rows;return {history,preference:preference.rows[0]??{whatsapp_consent_status:'unknown',consent_source:'',version:null},enrollment:enrollment.rows[0]??null};}
