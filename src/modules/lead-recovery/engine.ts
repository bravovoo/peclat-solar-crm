import type {PoolClient} from 'pg';
import {database,transaction} from '@/server/db';
import type {Actor} from '@/modules/auth/policy';
import {sendWhatsAppRecoveryTemplate} from '@/modules/whatsapp/outbound';
import type {MetaFetcher} from '@/modules/whatsapp/meta';
import {assessLead,loadLeadFacts,loadRecoveryConfig,type LeadFact,type RecoveryStep} from './eligibility';
import {nextRecoveryWindow,recoveryDueAt,recoveryEligibleAt,recoveryIsOpen,recoveryTimezone} from './schedule';
import {reconcileHistoricalWhatsAppOptIns} from '@/modules/whatsapp/marketing-consent';

type Db=Pick<PoolClient,'query'>;
type Attempt={id:string;organization_id:string;enrollment_id:string;step_position:number;template_id:string;client_request_id:string;attempts:number};
type Snapshot={steps:RecoveryStep[];business_hours:Record<string,unknown>;timezone:string};
type Enrollment={id:string;record_id:string;conversation_id:string;owner_id:string;status:string;inactivity_anchor:string;anchor_message_id:string|null;sequence_snapshot:Snapshot;attempt_count:number};
const parse=<T>(value:unknown):T=>typeof value==='string'?JSON.parse(value) as T:value as T;
export async function lockRecoveryOrganization(db:Db,org:string){
 // Same order as inbound: integration -> organization -> conversation -> cycle -> attempt.
 await db.query('SELECT organization_id FROM whatsapp_integrations WHERE organization_id=$1 FOR SHARE',[org]);
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[org]);
}
function cleanFact(f:LeadFact):LeadFact{return {...f,enrollment_id:null,enrollment_status:null,enrollment_version:null,attempt_count:null,next_attempt_at:null,state_reason:null};}
async function cancelCycle(db:Db,org:string,id:string,reason:string){
 await db.query("UPDATE lead_recovery_enrollments SET status='cancelled',state_reason=$3,next_attempt_at=NULL,version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2 AND status IN ('scheduled','paused')",[org,id,reason]);
 await db.query("UPDATE lead_recovery_attempts SET status='cancelled',safe_error=$3,locked_at=NULL,completed_at=now(),updated_at=now() WHERE organization_id=$1 AND enrollment_id=$2 AND status IN ('pending','processing')",[org,id,reason]);
}
async function insertAttempt(db:Db,org:string,e:Enrollment,step:RecoveryStep,hours:Record<string,unknown>){
 const eligible=recoveryEligibleAt(e.inactivity_anchor,step.delay_days),scheduled=recoveryDueAt(e.inactivity_anchor,step.delay_days,hours);
 await db.query(`INSERT INTO lead_recovery_attempts(organization_id,enrollment_id,step_position,template_id,scheduled_for,eligible_at,day_offset,timezone,client_request_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,gen_random_uuid()) ON CONFLICT(organization_id,enrollment_id,step_position) DO NOTHING`,[org,e.id,step.position,step.template_id,scheduled,eligible,step.delay_days,recoveryTimezone]);
 await db.query('UPDATE lead_recovery_enrollments SET next_attempt_at=$3,updated_at=now() WHERE organization_id=$1 AND id=$2',[org,e.id,scheduled]);
}
export async function refreshLeadRecoveryEnrollments(now=new Date()){
 const organizations=await database().query<{organization_id:string}>("SELECT organization_id FROM organization_lead_recovery_settings WHERE enabled");let created=0,cancelled=0;
 for(const {organization_id:org} of organizations.rows){await transaction(async db=>{await lockRecoveryOrganization(db,org);await reconcileHistoricalWhatsAppOptIns(db,org);});let afterId:string|undefined;
  for(;;){const batch=await loadLeadFacts(database(),org,undefined,100,undefined,afterId,now);if(!batch.length)break;
   for(const candidate of batch)await transaction(async db=>{
    await lockRecoveryOrganization(db,org);
    const loaded=await loadRecoveryConfig(db,org);if(!loaded?.settings.enabled||!loaded.steps.length)return;
    const fact=(await loadLeadFacts(db,org,undefined,1,candidate.id,undefined,now))[0];if(!fact)return;
    if(fact.conversation_id)await db.query('SELECT id FROM whatsapp_conversations WHERE organization_id=$1 AND id=$2 FOR UPDATE',[org,fact.conversation_id]);
    const active=(await db.query<Enrollment>("SELECT * FROM lead_recovery_enrollments WHERE organization_id=$1 AND record_id=$2 AND status IN ('scheduled','paused') FOR UPDATE",[org,fact.id])).rows[0];
    const assessment=assessLead(cleanFact(fact),loaded.settings,loaded.steps,now);
    if(active){
     if(!assessment.eligible){await cancelCycle(db,org,active.id,assessment.reason);cancelled++;return;}
     if(active.anchor_message_id===fact.anchor_message_id)return;
     if(active.status==='paused')return;
     await cancelCycle(db,org,active.id,'new_company_outbound');cancelled++;
    }
    if(!assessment.eligible||!fact.anchor_message_id||!fact.conversation_id||!assessment.inactivity_anchor)return;
    const snapshot:Snapshot={steps:loaded.steps,business_hours:loaded.settings.business_hours,timezone:recoveryTimezone};
    const inserted=await db.query<Enrollment>(`INSERT INTO lead_recovery_enrollments(organization_id,record_id,conversation_id,owner_id,classification,inactivity_anchor,anchor_message_id,sequence_snapshot,created_by,updated_by) VALUES ($1,$2,$3,$4,'awaiting_reply',$5,$6,$7,$8,$8) ON CONFLICT DO NOTHING RETURNING *`,[org,fact.id,fact.conversation_id,fact.owner_id??loaded.settings.updated_by,assessment.inactivity_anchor,fact.anchor_message_id,JSON.stringify(snapshot),loaded.settings.updated_by]);
    if(inserted.rows[0]){await insertAttempt(db,org,inserted.rows[0],loaded.steps[0],snapshot.business_hours);created++;}
   });
   afterId=batch.at(-1)!.id;if(batch.length<100)break;
  }
 }
 return {organizations:organizations.rowCount,created,cancelled};
}
async function deferAttempt(db:Db,a:Attempt,date:Date,reason:string){
 await db.query("UPDATE lead_recovery_attempts SET status='pending',locked_at=NULL,scheduled_for=$3,safe_error=$4,updated_at=now() WHERE organization_id=$1 AND id=$2 AND status='processing'",[a.organization_id,a.id,date,reason]);
 await db.query("UPDATE lead_recovery_enrollments SET next_attempt_at=$3 WHERE organization_id=$1 AND id=$2 AND status='scheduled'",[a.organization_id,a.enrollment_id,date]);
}
async function prepareAttempt(a:Attempt,now:Date){return transaction(async db=>{
 await lockRecoveryOrganization(db,a.organization_id);
 const preview=(await db.query<Enrollment>('SELECT * FROM lead_recovery_enrollments WHERE organization_id=$1 AND id=$2',[a.organization_id,a.enrollment_id])).rows[0];if(!preview)return null;
 await db.query('SELECT id FROM whatsapp_conversations WHERE organization_id=$1 AND id=$2 FOR UPDATE',[a.organization_id,preview.conversation_id]);
 const e=(await db.query<Enrollment>('SELECT * FROM lead_recovery_enrollments WHERE organization_id=$1 AND id=$2 FOR UPDATE',[a.organization_id,a.enrollment_id])).rows[0];
 const current=(await db.query<{status:string}>("SELECT status FROM lead_recovery_attempts WHERE organization_id=$1 AND id=$2 FOR UPDATE",[a.organization_id,a.id])).rows[0];
 if(e.status!=='scheduled'||current?.status!=='processing')return null;
 const loaded=await loadRecoveryConfig(db,a.organization_id);if(!loaded?.settings.enabled){await deferAttempt(db,a,new Date(now.getTime()+300000),'organization_disabled');return null;}
 const snapshot=parse<Snapshot>(e.sequence_snapshot),step=snapshot.steps?.find(s=>s.position===a.step_position);
 if(!step||step.position>4||!e.anchor_message_id){await cancelCycle(db,a.organization_id,e.id,'schedule_upgrade_required');return null;}
 const fact=(await loadLeadFacts(db,a.organization_id,undefined,1,e.record_id,undefined,now))[0];
 if(!fact){await cancelCycle(db,a.organization_id,e.id,'record_unavailable');return null;}
 const assessment=assessLead(cleanFact(fact),loaded.settings,loaded.steps,now);
 if(!assessment.eligible||fact.anchor_message_id!==e.anchor_message_id){await cancelCycle(db,a.organization_id,e.id,assessment.eligible?'new_company_outbound':assessment.reason);return null;}
 const global=(await db.query('SELECT whatsapp_outbound_enabled FROM organization_automation_settings WHERE organization_id=$1',[a.organization_id])).rows[0];
 if(!global?.whatsapp_outbound_enabled){await deferAttempt(db,a,new Date(now.getTime()+300000),'automation_outbound_kill_switch');return null;}
 const eligible=recoveryEligibleAt(e.inactivity_anchor,step.delay_days),hours=loaded.settings.business_hours;
 if(now<eligible||!recoveryIsOpen(hours,now)){await deferAttempt(db,a,nextRecoveryWindow(now<eligible?eligible:now,hours),'outside_business_hours');return null;}
 if(step.template_id!==a.template_id){await cancelCycle(db,a.organization_id,e.id,'template_mismatch');return null;}
 const actor=await actorFor(db,a.organization_id,loaded.settings.updated_by);
 await db.query('UPDATE lead_recovery_attempts SET attempts=attempts+1 WHERE organization_id=$1 AND id=$2',[a.organization_id,a.id]);
 return {actor,conversationId:e.conversation_id,fact,step};
});}
async function finishSent(a:Attempt,messageId:string,now:Date){await transaction(async db=>{
 await lockRecoveryOrganization(db,a.organization_id);
 const e=(await db.query<Enrollment>('SELECT * FROM lead_recovery_enrollments WHERE organization_id=$1 AND id=$2 FOR UPDATE',[a.organization_id,a.enrollment_id])).rows[0];if(!e)return;
 await db.query("UPDATE lead_recovery_attempts SET status='sent',message_id=$3,sent_at=COALESCE(sent_at,$4),completed_at=$4,locked_at=NULL,safe_error='',updated_at=now() WHERE organization_id=$1 AND id=$2",[a.organization_id,a.id,messageId,now]);
 if(e.status!=='scheduled')return;
 const snapshot=parse<Snapshot>(e.sequence_snapshot),next=snapshot.steps?.find(s=>s.position===a.step_position+1&&s.position<=4);
 await db.query('UPDATE lead_recovery_enrollments SET attempt_count=GREATEST(attempt_count,$3),last_attempt_at=$4,version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2',[a.organization_id,e.id,a.step_position,now]);
 if(next)await insertAttempt(db,a.organization_id,e,next,snapshot.business_hours);
 else await db.query("UPDATE lead_recovery_enrollments SET status='completed',next_attempt_at=NULL,state_reason='sequence_completed' WHERE organization_id=$1 AND id=$2",[a.organization_id,e.id]);
});}
async function failAttempt(a:Attempt,error:unknown,now:Date){
 const code=error instanceof Error&&/^(lead_recovery_|automation_outbound_)/.test(error.message)?error.message.slice(0,180):'lead_recovery_provider_error';
 await transaction(async db=>{
  await lockRecoveryOrganization(db,a.organization_id);
  const e=(await db.query<Enrollment>('SELECT * FROM lead_recovery_enrollments WHERE organization_id=$1 AND id=$2 FOR UPDATE',[a.organization_id,a.enrollment_id])).rows[0];
  const current=(await db.query('SELECT status,attempts FROM lead_recovery_attempts WHERE organization_id=$1 AND id=$2 FOR UPDATE',[a.organization_id,a.id])).rows[0];if(!e||!current||current.status!=='processing')return;
  const m=(await db.query('SELECT id,outcome_uncertain,delivery_status FROM whatsapp_messages WHERE organization_id=$1 AND lead_recovery_attempt_id=$2',[a.organization_id,a.id])).rows[0];
  const uncertain=Boolean(m&&(m.outcome_uncertain||m.delivery_status!=='failed'));
  const safeRetry=m?.delivery_status==='failed'&&!uncertain&&code==='lead_recovery_provider_error'&&current.attempts<3&&e.status==='scheduled';
  if(safeRetry){await deferAttempt(db,a,new Date(now.getTime()+current.attempts*300000),code);return;}
  await db.query("UPDATE lead_recovery_attempts SET status=$3,safe_error=$4,locked_at=NULL,completed_at=$5 WHERE organization_id=$1 AND id=$2",[a.organization_id,a.id,uncertain?'uncertain':e.status!=='scheduled'?'cancelled':'failed',code,now]);
  await db.query("UPDATE lead_recovery_enrollments SET status='error',state_reason=$3,next_attempt_at=NULL,version=version+1 WHERE organization_id=$1 AND id=$2 AND status='scheduled'",[a.organization_id,a.enrollment_id,code]);
 });
}
export async function processLeadRecoveryAttempts(limit=20,fetcher?:MetaFetcher,now=new Date()){
 const stale=await database().query<Attempt&{message_id:string|null;delivery_status:string|null}>(`SELECT a.*,m.id message_id,m.delivery_status FROM lead_recovery_attempts a LEFT JOIN whatsapp_messages m ON m.organization_id=a.organization_id AND m.lead_recovery_attempt_id=a.id WHERE a.status='processing' AND a.locked_at<$1::timestamptz-interval '10 minutes' LIMIT $2`,[now,limit]);
 for(const a of stale.rows){if(a.message_id&&['sent','delivered','read'].includes(a.delivery_status??''))await finishSent(a,a.message_id,now);else await failAttempt(a,new Error('lead_recovery_stale'),now);}
 const jobs=await transaction(async db=>{const result=await db.query<Attempt>(`SELECT a.* FROM lead_recovery_attempts a JOIN lead_recovery_enrollments e ON e.organization_id=a.organization_id AND e.id=a.enrollment_id JOIN organization_lead_recovery_settings s ON s.organization_id=a.organization_id WHERE a.status='pending' AND a.scheduled_for<=$1 AND e.status='scheduled' AND s.enabled ORDER BY a.scheduled_for,a.id FOR UPDATE OF a SKIP LOCKED LIMIT $2`,[now,limit]);if(result.rowCount)await db.query("UPDATE lead_recovery_attempts SET status='processing',locked_at=$2,updated_at=now() WHERE id=ANY($1::uuid[])",[result.rows.map(r=>r.id),now]);return result.rows;});
 let sent=0;for(const a of jobs){try{const p=await prepareAttempt(a,now);if(!p)continue;const parameters={header:parse<string[]>(p.step.header_parameters).map(v=>render(v,p.fact,p.actor)),body:parse<string[]>(p.step.body_parameters).map(v=>render(v,p.fact,p.actor))};const message=await sendWhatsAppRecoveryTemplate(p.actor,p.conversationId,{client_request_id:a.client_request_id,template_id:a.template_id,parameters},{attemptId:a.id,now},fetcher);if(message.outcome_uncertain||!['sent','delivered','read'].includes(message.delivery_status))throw new Error('lead_recovery_uncertain');await finishSent(a,message.id,now);sent++;}catch(error){await failAttempt(a,error,now);}}
 return {processed:jobs.length,sent};
}
export async function runLeadRecoveryScheduler(){await refreshLeadRecoveryEnrollments();return processLeadRecoveryAttempts();}

async function actorFor(db:Db,organizationId:string,userId:string):Promise<Actor>{const result=await db.query(`SELECT u.id user_id,u.name,u.email,o.name organization_name,o.slug organization_slug,m.role_code role,r.name role_name,COALESCE(array_agg(rp.permission_code) FILTER(WHERE rp.permission_code IS NOT NULL),'{}') permissions FROM memberships m JOIN users u ON u.id=m.user_id JOIN organizations o ON o.id=m.organization_id JOIN roles r ON r.code=m.role_code LEFT JOIN role_permissions rp ON rp.role_code=m.role_code WHERE m.organization_id=$1 AND m.user_id=$2 AND m.active AND u.active GROUP BY u.id,u.name,u.email,o.name,o.slug,m.role_code,r.name`,[organizationId,userId]);const row=result.rows[0];if(!row)throw new Error('lead_recovery_actor_unavailable');return {userId:row.user_id,organizationId,name:row.name,email:row.email,organizationName:row.organization_name,organizationSlug:row.organization_slug,role:row.role,roleName:row.role_name,permissions:row.permissions};}

export function leadFirstName(value:string){const first=value.trim().split(/\s+/u)[0]?.replace(/[^\p{L}\p{M}'’-]/gu,'').slice(0,80);return first||'Cliente';}
function render(value:string,fact:LeadFact,actor:Actor){return value.replaceAll('{{lead_first_name}}',leadFirstName(fact.name)).replaceAll('{{lead_name}}',fact.name).replaceAll('{{seller_name}}',fact.owner_name||actor.name).replaceAll('{{organization_name}}',actor.organizationName);}


export async function handleLeadRecoveryInbound(db:Db,input:{organizationId:string;conversationId:string;recordId:string|null;actorId:string;timestamp:Date;text:string}){
 const normalized=input.text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9 ]/g,' ').trim().replace(/\s+/g,' '),optOut=['sair','parar','pare','cancelar','descadastrar','remover','nao quero','nao quero receber','nao quero mais','nao receber mais'].includes(normalized),enrollment=await db.query<{id:string;record_id:string;owner_id:string;status:string}>(`SELECT e.id,e.record_id,e.owner_id,e.status FROM lead_recovery_enrollments e WHERE e.organization_id=$1 AND (e.conversation_id=$2 OR ($3::uuid IS NOT NULL AND e.record_id=$3)) AND e.status IN ('scheduled','paused') AND e.inactivity_anchor<=$4 ORDER BY e.created_at DESC LIMIT 1 FOR UPDATE`,[input.organizationId,input.conversationId,input.recordId,input.timestamp]);
 if(!enrollment.rows[0]){if(!optOut)return {interrupted:false};await persistWhatsAppOptOut(db,input,input.recordId,input.actorId);return {interrupted:false,optOut:true};}
 const row=enrollment.rows[0],status=optOut?'cancelled':'responded',reason=optOut?'contact_opt_out':'client_replied';
 await db.query('UPDATE lead_recovery_enrollments SET status=$3,response_at=$4,next_attempt_at=NULL,state_reason=$5,version=version+1,updated_by=$6,updated_at=now() WHERE organization_id=$1 AND id=$2',[input.organizationId,row.id,status,input.timestamp,reason,row.owner_id]);await db.query("UPDATE lead_recovery_attempts SET status='cancelled',safe_error=$3,completed_at=now(),updated_at=now() WHERE organization_id=$1 AND enrollment_id=$2 AND status IN ('pending','processing')",[input.organizationId,row.id,reason]);
 if(optOut)await persistWhatsAppOptOut(db,input,row.record_id,row.owner_id);
 await db.query(`INSERT INTO user_notifications(organization_id,user_id,notification_type,title,detail,entity_type,entity_id) VALUES ($1,$2,$3,$4,$5,'lead',$6)`,[input.organizationId,row.owner_id,optOut?'lead_recovery.opt_out':'lead_recovery.response',optOut?'Cliente solicitou descadastramento':'Lead respondeu à recuperação',optOut?'O contato foi bloqueado e as próximas tentativas foram canceladas.':'As próximas tentativas foram canceladas. Abra o atendimento para continuar.',row.record_id]);await db.query("INSERT INTO crm_activities(organization_id,record_id,actor_id,action,detail) VALUES ($1,$2,$3,$4,$5)",[input.organizationId,row.record_id,row.owner_id,optOut?'lead_recovery.opted_out':'lead_recovery.responded',optOut?'Descadastramento solicitado pelo WhatsApp.':'Cliente respondeu; sequência automática interrompida.']);return {interrupted:true,optOut};
}
async function persistWhatsAppOptOut(db:Db,input:{organizationId:string;conversationId:string},recordId:string|null,actorId:string){
 if(recordId)await db.query(`INSERT INTO crm_contact_preferences(organization_id,record_id,whatsapp_consent_status,consent_source,opted_out_at,updated_by) VALUES ($1,$2,'opted_out','Solicitação recebida pelo WhatsApp',now(),$3) ON CONFLICT(organization_id,record_id) DO UPDATE SET whatsapp_consent_status='opted_out',opted_out_at=now(),updated_by=EXCLUDED.updated_by,version=crm_contact_preferences.version+1,updated_at=now()`,[input.organizationId,recordId,actorId]);
 await db.query('UPDATE whatsapp_conversations SET automation_blocked=true,version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2',[input.organizationId,input.conversationId]);
}
