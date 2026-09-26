import type {PoolClient} from 'pg';
import {database,transaction} from '@/server/db';
import {serviceWindow} from './domain';
import {MetaSendError,metaConfiguration,sendMetaMessage,type MetaFetcher} from './meta';
import {automaticConsentPrompt} from './marketing-consent';

type Db=Pick<PoolClient,'query'>;
type Candidate={organization_id:string;conversation_id:string};
type Conversation={id:string;organization_id:string;external_wa_id:string;record_id:string;last_inbound_at:Date;automation_blocked:boolean;conversation_status:string;api_version:string;phone_number_id:string;business_account_id:string;updated_by:string;status:string;record_status:string;consent_status:string;recovery_enabled:boolean;outbound_enabled:boolean;company_replied:boolean};
type Reservation={organizationId:string;conversationId:string;messageId:string;recipient:string;integration:Conversation};

/** A conversation ID is the stable request ID: one automatic question per conversation. */
async function reserve(db:Db,candidate:Candidate,now:Date):Promise<Reservation|null>{
 const result=await db.query<Conversation>(`SELECT c.id,c.organization_id,c.external_wa_id,c.record_id,c.last_inbound_at,c.automation_blocked,c.status conversation_status,i.api_version,i.phone_number_id,i.business_account_id,i.updated_by,i.status,r.status record_status,COALESCE(p.whatsapp_consent_status,'unknown') consent_status,s.enabled recovery_enabled,a.whatsapp_outbound_enabled outbound_enabled,
  EXISTS(SELECT 1 FROM whatsapp_messages m WHERE m.organization_id=c.organization_id AND m.conversation_id=c.id AND m.direction='outbound' AND m.meta_timestamp>c.last_inbound_at AND m.origin<>'lead_recovery' AND COALESCE(m.safe_metadata->>'system_purpose','')<>'consent_request' AND m.delivery_status IN ('sent','delivered','read')) company_replied
  FROM whatsapp_conversations c JOIN crm_records r ON r.organization_id=c.organization_id AND r.id=c.record_id AND r.kind='lead' AND r.deleted_at IS NULL
  JOIN whatsapp_integrations i ON i.organization_id=c.organization_id
  LEFT JOIN crm_contact_preferences p ON p.organization_id=r.organization_id AND p.record_id=r.id
  JOIN organization_lead_recovery_settings s ON s.organization_id=c.organization_id
  JOIN organization_automation_settings a ON a.organization_id=c.organization_id
  WHERE c.organization_id=$1 AND c.id=$2 FOR UPDATE OF c`,[candidate.organization_id,candidate.conversation_id]);
 const row=result.rows[0];if(!row||row.status!=='connected'||row.conversation_status!=='open'||row.record_status!=='active'||row.automation_blocked||row.consent_status!=='unknown'||!row.recovery_enabled||!row.outbound_enabled||!row.company_replied||!serviceWindow(row.last_inbound_at?new Date(row.last_inbound_at):null,now).open)return null;
 const inserted=await db.query<{id:string}>(`INSERT INTO whatsapp_messages(organization_id,conversation_id,meta_message_id,direction,message_type,text_body,sender_wa_id,meta_timestamp,processing_status,sent_by,client_request_id,delivery_status,origin,safe_metadata)
  VALUES ($1,$2,NULL,'outbound','interactive',$3,'',$4,'processed',$5,$2,'pending','manual',$6::jsonb)
  ON CONFLICT DO NOTHING RETURNING id`,[row.organization_id,row.id,automaticConsentPrompt,now,row.updated_by,JSON.stringify({system_purpose:'consent_request',request_state:'reserved'})]);
 if(!inserted.rows[0])return null;
 return {organizationId:row.organization_id,conversationId:row.id,messageId:inserted.rows[0].id,recipient:row.external_wa_id,integration:row};
}

async function claim(item:Reservation,now:Date){return transaction(async db=>{
 const locked=await db.query<Conversation>(`SELECT c.id,c.organization_id,c.external_wa_id,c.record_id,c.last_inbound_at,c.automation_blocked,c.status conversation_status,i.api_version,i.phone_number_id,i.business_account_id,i.updated_by,i.status,r.status record_status,COALESCE(p.whatsapp_consent_status,'unknown') consent_status,s.enabled recovery_enabled,a.whatsapp_outbound_enabled outbound_enabled,
  EXISTS(SELECT 1 FROM whatsapp_messages m WHERE m.organization_id=c.organization_id AND m.conversation_id=c.id AND m.direction='outbound' AND m.meta_timestamp>c.last_inbound_at AND m.origin<>'lead_recovery' AND COALESCE(m.safe_metadata->>'system_purpose','')<>'consent_request' AND m.delivery_status IN ('sent','delivered','read')) company_replied
  FROM whatsapp_conversations c JOIN crm_records r ON r.organization_id=c.organization_id AND r.id=c.record_id AND r.kind='lead' AND r.deleted_at IS NULL
  JOIN whatsapp_integrations i ON i.organization_id=c.organization_id LEFT JOIN crm_contact_preferences p ON p.organization_id=r.organization_id AND p.record_id=r.id
  JOIN organization_lead_recovery_settings s ON s.organization_id=c.organization_id JOIN organization_automation_settings a ON a.organization_id=c.organization_id
  WHERE c.organization_id=$1 AND c.id=$2 FOR UPDATE OF c`,[item.organizationId,item.conversationId]);
 const row=locked.rows[0],valid=Boolean(row&&row.status==='connected'&&row.conversation_status==='open'&&row.record_status==='active'&&!row.automation_blocked&&row.consent_status==='unknown'&&row.recovery_enabled&&row.outbound_enabled&&row.company_replied&&serviceWindow(row.last_inbound_at?new Date(row.last_inbound_at):null,now).open);
 if(!valid){await db.query(`UPDATE whatsapp_messages SET delivery_status='failed',failed_at=now(),failure_code='consent_request_not_eligible',safe_metadata=safe_metadata||'{"request_state":"skipped"}'::jsonb WHERE organization_id=$1 AND id=$2 AND safe_metadata->>'request_state'='reserved'`,[item.organizationId,item.messageId]);return false;}
 const updated=await db.query(`UPDATE whatsapp_messages SET safe_metadata=safe_metadata||'{"request_state":"sending"}'::jsonb WHERE organization_id=$1 AND id=$2 AND safe_metadata->>'request_state'='reserved' RETURNING id`,[item.organizationId,item.messageId]);
 return Boolean(updated.rowCount);
 });}

export async function processAutomaticConsentRequests(limit=20,fetcher?:MetaFetcher,now=new Date(),organizationId?:string){
 const candidates=await database().query<Candidate>(`SELECT c.organization_id,c.id conversation_id FROM whatsapp_conversations c
  JOIN crm_records r ON r.organization_id=c.organization_id AND r.id=c.record_id AND r.kind='lead' AND r.status='active' AND r.deleted_at IS NULL
  JOIN whatsapp_integrations i ON i.organization_id=c.organization_id AND i.status='connected'
  JOIN organization_lead_recovery_settings s ON s.organization_id=c.organization_id AND s.enabled
  JOIN organization_automation_settings a ON a.organization_id=c.organization_id AND a.whatsapp_outbound_enabled
  LEFT JOIN crm_contact_preferences p ON p.organization_id=r.organization_id AND p.record_id=r.id
  WHERE c.last_inbound_at>$1::timestamptz-interval '24 hours' AND c.last_inbound_at<=$1 AND c.status='open' AND NOT c.automation_blocked AND ($3::uuid IS NULL OR c.organization_id=$3)
   AND COALESCE(p.whatsapp_consent_status,'unknown')='unknown'
   AND EXISTS(SELECT 1 FROM whatsapp_messages m WHERE m.organization_id=c.organization_id AND m.conversation_id=c.id AND m.direction='outbound' AND m.meta_timestamp>c.last_inbound_at AND m.origin<>'lead_recovery' AND COALESCE(m.safe_metadata->>'system_purpose','')<>'consent_request' AND m.delivery_status IN ('sent','delivered','read'))
   AND NOT EXISTS(SELECT 1 FROM whatsapp_messages m WHERE m.organization_id=c.organization_id AND m.conversation_id=c.id AND m.client_request_id=c.id)
  ORDER BY c.last_inbound_at,c.id LIMIT $2`,[now,limit,organizationId??null]);
 let sent=0,skipped=0;
 for(const candidate of candidates.rows){
  const item=await transaction(db=>reserve(db,candidate,now));if(!item){skipped++;continue;}
  if(!await claim(item,new Date())){skipped++;continue;}
  try{
   const result=await sendMetaMessage(metaConfiguration(item.integration),{messaging_product:'whatsapp',recipient_type:'individual',to:item.recipient,type:'interactive',interactive:{type:'button',body:{text:automaticConsentPrompt},action:{buttons:[{type:'reply',reply:{id:'peclat_consent_yes',title:'Sim, autorizo'}},{type:'reply',reply:{id:'peclat_consent_no',title:'Não quero'}}]}}},fetcher);
   await transaction(async db=>{
    await db.query(`UPDATE whatsapp_messages SET meta_message_id=$3,delivery_status='sent',sent_at=now(),safe_metadata=safe_metadata||'{"request_state":"sent"}'::jsonb WHERE organization_id=$1 AND id=$2`,[item.organizationId,item.messageId,result.wamid]);
    await db.query(`UPDATE whatsapp_conversations SET last_message_preview=$3,last_message_type='interactive',last_message_at=GREATEST(COALESCE(last_message_at,$4),$4),version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2 AND (last_message_at IS NULL OR last_message_at<=$4)`,[item.organizationId,item.conversationId,automaticConsentPrompt,new Date()]);
   });sent++;
  }catch(error){
   const uncertain=!(error instanceof MetaSendError)||error.kind==='uncertain';
   await database().query(`UPDATE whatsapp_messages SET delivery_status=CASE WHEN $3 THEN 'pending' ELSE 'failed' END,outcome_uncertain=$3,failed_at=CASE WHEN $3 THEN NULL ELSE now() END,failure_code=$4,safe_metadata=safe_metadata||jsonb_build_object('request_state',CASE WHEN $3 THEN 'uncertain' ELSE 'rejected' END) WHERE organization_id=$1 AND id=$2`,[item.organizationId,item.messageId,uncertain,error instanceof MetaSendError?error.safeCode:'local_persist_failed']).catch(()=>undefined);
   skipped++;
  }
 }
 return {candidates:candidates.rowCount,sent,skipped};
}
