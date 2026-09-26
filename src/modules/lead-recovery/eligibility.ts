import type {PoolClient} from 'pg';
import type {Actor} from '@/modules/auth/policy';
import {commercialScope,commercialScopeParams} from '@/modules/commercial/scope';
import {normalizeWhatsAppNumber} from '@/modules/whatsapp/domain';

type Db=Pick<PoolClient,'query'>;
export type RecoveryConfig={
 organization_id:string;enabled:boolean;include_uncontacted:boolean;timezone:string;business_hours:Record<string,unknown>;
 lead_stages:string[];seller_ids:string[];version:number;updated_by:string;
};
export type RecoveryStep={id:string;position:number;delay_days:number;template_id:string;header_parameters:string[];body_parameters:string[];template_name:string;template_language:string;template_status:string;supported:boolean};
export type LeadFact={
 id:string;name:string;stage:string;status:string;owner_id:string;owner_name:string;created_at:string;updated_at:string;phone:string;
 consent_status:'unknown'|'opted_in'|'opted_out';consent_source:string;consent_version:number|null;
 service_started_at:string|null;service_source:string;
 conversation_id:string|null;automations_paused:boolean|null;automation_blocked:boolean|null;
 last_inbound_at:string|null;last_manual_outbound_at:string|null;last_commercial_activity_at:string|null;
 future_task_at:string|null;has_won_opportunity:boolean;has_lost_opportunity:boolean;has_accepted_proposal:boolean;owner_active:boolean;
 enrollment_id:string|null;enrollment_status:'scheduled'|'paused'|'responded'|'completed'|'cancelled'|'error'|null;enrollment_version:number|null;attempt_count:number|null;next_attempt_at:string|null;state_reason:string|null;
};
export type LeadAssessment=LeadFact&{
 classification:'not_contacted'|'awaiting_reply'|null;
 eligible:boolean;reason:string;reason_label:string;inactivity_anchor:string|null;scheduled_for:string|null;inactivity_days:number;
 normalized_phone:string|null;
};

export const exclusionLabels:Record<string,string>={
 consent_required:'Consentimento de marketing não registrado',opted_out:'Cliente descadastrado',record_inactive:'Lead inativo ou convertido',stage_excluded:'Etapa fora da configuração',
 seller_excluded:'Vendedor fora da configuração',owner_inactive:'Responsável inativo',invalid_phone:'WhatsApp inválido',follow_up_scheduled:'Acompanhamento já agendado',
 negotiation_concluded:'Negociação concluída',proposal_accepted:'Proposta aceita',conversation_paused:'Automação pausada para a conversa',contact_blocked:'Contato bloqueado/opt-out',
 awaiting_seller:'Cliente aguarda resposta do vendedor',uncontacted_disabled:'Leads não contatados não incluídos',waiting_period:'Aguardando prazo configurado',
 missing_template:'Sequência sem modelo aprovado',eligible:'Elegível',scheduled:'Recuperação agendada',responded:'Cliente respondeu',completed:'Sequência concluída',cancelled:'Cancelada',error:'Erro',paused:'Pausada',
};

export async function loadRecoveryConfig(db:Db,organizationId:string){
 const setting=await db.query<RecoveryConfig>('SELECT * FROM organization_lead_recovery_settings WHERE organization_id=$1',[organizationId]);
 if(!setting.rows[0])return null;
 const steps=await db.query<RecoveryStep>(`SELECT s.id,s.position,s.delay_days,s.template_id,s.header_parameters,s.body_parameters,t.name template_name,t.language template_language,t.status template_status,t.supported
  FROM lead_recovery_steps s JOIN whatsapp_templates t ON t.organization_id=s.organization_id AND t.id=s.template_id
  WHERE s.organization_id=$1 ORDER BY s.position`,[organizationId]);
 return {settings:{...setting.rows[0],business_hours:typeof setting.rows[0].business_hours==='string'?JSON.parse(setting.rows[0].business_hours):setting.rows[0].business_hours},steps:steps.rows};
}

export async function loadLeadFacts(db:Db,organizationId:string,actor?:Actor,limit=1000):Promise<LeadFact[]>{
 const params=actor?commercialScopeParams(actor):[organizationId];
 params.push(limit);
 const scope=actor?commercialScope(actor,'r',true):'r.organization_id=$1';
 const result=await db.query<LeadFact>(`SELECT r.id,r.name,r.stage,r.status,r.owner_id,u.name owner_name,r.created_at,r.updated_at,COALESCE(NULLIF(r.whatsapp,''),r.phone) phone,
  COALESCE(p.whatsapp_consent_status,'unknown') consent_status,COALESCE(p.consent_source,'') consent_source,p.version consent_version,
  p.whatsapp_service_started_at service_started_at,COALESCE(p.whatsapp_service_source,'') service_source,
  c.id conversation_id,c.automations_paused,c.automation_blocked,c.last_inbound_at,
  messages.last_manual_outbound_at,activities.last_commercial_activity_at,tasks.future_task_at,
  EXISTS(SELECT 1 FROM crm_opportunities o WHERE o.organization_id=r.organization_id AND o.lead_id=r.id AND o.status='won') has_won_opportunity,
  EXISTS(SELECT 1 FROM crm_opportunities o WHERE o.organization_id=r.organization_id AND o.lead_id=r.id AND o.status='lost') has_lost_opportunity,
  EXISTS(SELECT 1 FROM crm_documents d JOIN crm_opportunities o ON o.organization_id=d.organization_id AND o.id=d.opportunity_id WHERE d.organization_id=r.organization_id AND o.lead_id=r.id AND d.status='accepted') has_accepted_proposal,
  (m.active AND u.active) owner_active,
  enrollment.id enrollment_id,enrollment.status enrollment_status,enrollment.version enrollment_version,enrollment.attempt_count,enrollment.next_attempt_at,enrollment.state_reason
 FROM crm_records r
 JOIN memberships m ON m.organization_id=r.organization_id AND m.user_id=r.owner_id
 JOIN users u ON u.id=r.owner_id
 LEFT JOIN crm_contact_preferences p ON p.organization_id=r.organization_id AND p.record_id=r.id
 LEFT JOIN LATERAL (SELECT wc.* FROM whatsapp_conversations wc WHERE wc.organization_id=r.organization_id AND wc.record_id=r.id ORDER BY wc.last_message_at DESC NULLS LAST,wc.id LIMIT 1) c ON true
 LEFT JOIN LATERAL (SELECT max(wm.meta_timestamp) FILTER(WHERE wm.direction='outbound' AND wm.origin='manual') last_manual_outbound_at FROM whatsapp_messages wm WHERE wm.organization_id=r.organization_id AND wm.conversation_id=c.id) messages ON true
 LEFT JOIN LATERAL (SELECT max(a.created_at) last_commercial_activity_at FROM crm_activities a WHERE a.organization_id=r.organization_id AND a.record_id=r.id AND a.action NOT LIKE 'lead_recovery.%') activities ON true
 LEFT JOIN LATERAL (SELECT min(t.due_at) future_task_at FROM crm_tasks t WHERE t.organization_id=r.organization_id AND t.record_id=r.id AND t.status IN ('pending','in_progress') AND t.due_at>now()) tasks ON true
 LEFT JOIN LATERAL (SELECT e.* FROM lead_recovery_enrollments e WHERE e.organization_id=r.organization_id AND e.record_id=r.id ORDER BY (e.status IN ('scheduled','paused')) DESC,e.created_at DESC LIMIT 1) enrollment ON true
 WHERE ${scope} AND r.kind='lead' AND r.deleted_at IS NULL
 ORDER BY r.updated_at DESC,r.id LIMIT $${params.length}`,[...params]);
 return result.rows;
}

function later(...values:(string|null)[]){const dates=values.filter(Boolean).map(value=>new Date(value!).getTime()).filter(Number.isFinite);return dates.length?new Date(Math.max(...dates)).toISOString():null;}
function addDays(value:string,days:number){return new Date(new Date(value).getTime()+days*86400000).toISOString();}

export function assessLead(fact:LeadFact,config:RecoveryConfig,steps:RecoveryStep[],now=new Date()):LeadAssessment{
 const normalized=normalizeWhatsAppNumber(fact.phone);
 let classification:LeadAssessment['classification']=null,anchor:string|null=null,reason='';
 if(fact.status!=='active')reason='record_inactive';
 else if(fact.consent_status==='opted_out')reason='opted_out';
 else if(fact.consent_status!=='opted_in')reason='consent_required';
 else if(['won','lost'].includes(fact.stage))reason='negotiation_concluded';
 else if(!config.lead_stages.includes(fact.stage))reason='stage_excluded';
 else if(config.seller_ids.length&&!config.seller_ids.includes(fact.owner_id))reason='seller_excluded';
 else if(!fact.owner_active)reason='owner_inactive';
 else if(!normalized.valid)reason='invalid_phone';
 else if(fact.has_won_opportunity||fact.has_lost_opportunity)reason='negotiation_concluded';
 else if(fact.has_accepted_proposal)reason='proposal_accepted';
 else if(fact.future_task_at)reason='follow_up_scheduled';
 else if(fact.automations_paused)reason='conversation_paused';
 else if(fact.automation_blocked)reason='contact_blocked';
 else if(!steps.length||steps.some(step=>step.template_status!=='APPROVED'||!step.supported))reason='missing_template';
 else{
  const inbound=fact.last_inbound_at?new Date(fact.last_inbound_at).getTime():0,outbound=fact.last_manual_outbound_at?new Date(fact.last_manual_outbound_at).getTime():0;
  if(inbound&&inbound>=outbound)reason='awaiting_seller';
  else if(outbound){classification='awaiting_reply';anchor=new Date(outbound).toISOString();}
  else if(config.include_uncontacted){classification='not_contacted';anchor=later(fact.last_commercial_activity_at,fact.created_at);}
  else reason='uncontacted_disabled';
 }
 const first=steps[0],scheduled=anchor&&first?addDays(anchor,first.delay_days):null;
 if(!reason&&scheduled&&new Date(scheduled)>now)reason='waiting_period';
 if(fact.enrollment_status&&['scheduled','paused','responded','completed','cancelled','error'].includes(fact.enrollment_status)){
  const status=fact.enrollment_status;
  return {...fact,classification,eligible:status==='scheduled'||status==='paused',reason:status,reason_label:exclusionLabels[status]??status,inactivity_anchor:anchor,scheduled_for:fact.next_attempt_at??scheduled,inactivity_days:anchor?Math.max(0,Math.floor((now.getTime()-new Date(anchor).getTime())/86400000)):0,normalized_phone:normalized.e164};
 }
 return {...fact,classification,eligible:!reason||reason==='waiting_period',reason:reason||'eligible',reason_label:exclusionLabels[reason||'eligible'],inactivity_anchor:anchor,scheduled_for:scheduled,inactivity_days:anchor?Math.max(0,Math.floor((now.getTime()-new Date(anchor).getTime())/86400000)):0,normalized_phone:normalized.e164};
}
