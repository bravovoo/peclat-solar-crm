import type {PoolClient} from 'pg';
import {normalizeWhatsAppNumber} from './domain';
import {defaultWhatsAppLeadOwner} from './lead-owner';

type Db=Pick<PoolClient,'query'>;
type Resolution={recordId:string|null;status:'identified'|'unidentified'|'ambiguous';source:'automatic'|'none';created:boolean};
type Input={organizationId:string;waId:string;phoneE164:string;profileName:string;actorId:string;timestamp:Date;createIfMissing:boolean};

async function candidates(db:Db,organizationId:string,waId:string){
 const result=await db.query<{id:string}>(`SELECT DISTINCT match.id FROM (
   SELECT r.id FROM crm_records r
   WHERE r.organization_id=$1 AND r.deleted_at IS NULL
     AND $2 IN (crm_normalize_whatsapp_number(r.phone),crm_normalize_whatsapp_number(r.whatsapp))
   UNION
   SELECT rc.record_id id FROM crm_record_contacts rc
   JOIN crm_contacts contact ON contact.organization_id=rc.organization_id AND contact.id=rc.contact_id
   JOIN crm_records r ON r.organization_id=rc.organization_id AND r.id=rc.record_id AND r.deleted_at IS NULL
   WHERE rc.organization_id=$1
     AND $2 IN (crm_normalize_whatsapp_number(contact.phone),crm_normalize_whatsapp_number(contact.whatsapp))
  ) match ORDER BY match.id LIMIT 3`,[organizationId,waId]);
 return result.rows.map(row=>row.id);
}

async function rememberIdentity(db:Db,input:Input,recordId:string,source:'inbound'|'existing'){
 await db.query(`INSERT INTO crm_whatsapp_identities(organization_id,wa_id,phone_e164,record_id,profile_name,source,first_inbound_at,last_inbound_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
  ON CONFLICT(organization_id,wa_id) DO UPDATE SET
   phone_e164=EXCLUDED.phone_e164,
   profile_name=CASE WHEN EXCLUDED.profile_name<>'' THEN EXCLUDED.profile_name ELSE crm_whatsapp_identities.profile_name END,
   first_inbound_at=LEAST(COALESCE(crm_whatsapp_identities.first_inbound_at,EXCLUDED.first_inbound_at),EXCLUDED.first_inbound_at),
   last_inbound_at=GREATEST(COALESCE(crm_whatsapp_identities.last_inbound_at,EXCLUDED.last_inbound_at),EXCLUDED.last_inbound_at),
   updated_at=now()
  WHERE crm_whatsapp_identities.record_id=EXCLUDED.record_id`,[input.organizationId,input.waId,input.phoneE164,recordId,input.profileName,source,input.createIfMissing?input.timestamp:null]);
}

async function recordServiceContact(db:Db,input:Input,recordId:string){
 if(!input.createIfMissing)return;
 await db.query(`INSERT INTO crm_contact_preferences(organization_id,record_id,whatsapp_consent_status,consent_source,updated_by,whatsapp_service_started_at,whatsapp_last_inbound_at,whatsapp_service_source)
  VALUES ($1,$2,'unknown','',$3,$4,$4,'client_initiated')
  ON CONFLICT(organization_id,record_id) DO UPDATE SET
   whatsapp_service_started_at=LEAST(COALESCE(crm_contact_preferences.whatsapp_service_started_at,EXCLUDED.whatsapp_service_started_at),EXCLUDED.whatsapp_service_started_at),
   whatsapp_last_inbound_at=GREATEST(COALESCE(crm_contact_preferences.whatsapp_last_inbound_at,EXCLUDED.whatsapp_last_inbound_at),EXCLUDED.whatsapp_last_inbound_at),
   whatsapp_service_source='client_initiated',updated_at=now()`,[input.organizationId,recordId,input.actorId,input.timestamp]);
}

export async function resolveWhatsAppRecord(db:Db,input:Input):Promise<Resolution>{
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[input.organizationId]);
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${input.organizationId}:whatsapp:${input.waId}`]);
 const identity=await db.query<{record_id:string}>(`SELECT identity.record_id FROM crm_whatsapp_identities identity
  JOIN crm_records record ON record.organization_id=identity.organization_id AND record.id=identity.record_id
  WHERE identity.organization_id=$1 AND identity.wa_id=$2 AND record.deleted_at IS NULL FOR UPDATE OF identity,record`,[input.organizationId,input.waId]);
 let recordId=identity.rows[0]?.record_id??null,created=false;
 if(!recordId){
  const matches=await candidates(db,input.organizationId,input.waId);
  if(matches.length>1)return {recordId:null,status:'ambiguous',source:'none',created:false};
  recordId=matches[0]??null;
  if(!recordId&&input.createIfMissing){
   const safeName=input.profileName.trim().length>=2?input.profileName.trim().slice(0,180):'Contato WhatsApp';
   const ownerId=await defaultWhatsAppLeadOwner(db,input.organizationId);
   const inserted=await db.query<{id:string}>(`INSERT INTO crm_records(organization_id,kind,owner_id,name,phone,whatsapp,source,stage)
    VALUES ($1,'lead',$4,$2,$3,$3,'WhatsApp','new') RETURNING id`,[input.organizationId,safeName,input.waId,ownerId]);
   recordId=inserted.rows[0].id;created=true;
   await db.query(`INSERT INTO crm_activities(organization_id,record_id,actor_id,action,detail)
    VALUES ($1,$2,$3,'whatsapp.lead.created','Lead criado automaticamente após mensagem inbound do WhatsApp.')`,[input.organizationId,recordId,input.actorId]);
   await db.query(`INSERT INTO audit_logs(organization_id,actor_id,action,detail)
    VALUES ($1,$2,'whatsapp.lead.created','Lead criado automaticamente e vinculado por identidade WhatsApp.')`,[input.organizationId,input.actorId]);
   if(ownerId){
    await db.query(`INSERT INTO crm_activities(organization_id,record_id,actor_id,action,detail) VALUES ($1,$2,$3,'whatsapp.owner_assigned','Responsável padrão atribuído automaticamente ao Lead originado pelo WhatsApp.')`,[input.organizationId,recordId,ownerId]);
    await db.query(`INSERT INTO audit_logs(organization_id,actor_id,action,detail) VALUES ($1,$2,'whatsapp.owner_assigned',$3)`,[input.organizationId,ownerId,`Responsável padrão atribuído automaticamente; origem=WhatsApp; lead_id=${recordId}.`]);
   }
  }
 }
 if(!recordId)return {recordId:null,status:'unidentified',source:'none',created:false};
 await rememberIdentity(db,input,recordId,created?'inbound':'existing');
 await recordServiceContact(db,input,recordId);
 if(input.createIfMissing&&input.profileName.trim().length>=2)await db.query(`UPDATE crm_records SET name=$3,version=version+1,updated_at=now()
  WHERE organization_id=$1 AND id=$2 AND source IN ('WhatsApp','WhatsApp Flow') AND lower(name) IN ('contato whatsapp','não identificada')`,[input.organizationId,recordId,input.profileName.trim().slice(0,180)]);
 return {recordId,status:'identified',source:'automatic',created};
}

export async function setWhatsAppIdentity(db:Db,input:{organizationId:string;waId:string;phoneE164:string;recordId:string;profileName:string;source:'manual'|'flow'}){
 await lockWhatsAppIdentity(db,input.organizationId,input.waId);
 await db.query(`INSERT INTO crm_whatsapp_identities(organization_id,wa_id,phone_e164,record_id,profile_name,source)
  VALUES ($1,$2,$3,$4,$5,$6)
  ON CONFLICT(organization_id,wa_id) DO UPDATE SET record_id=EXCLUDED.record_id,phone_e164=EXCLUDED.phone_e164,
   profile_name=CASE WHEN EXCLUDED.profile_name<>'' THEN EXCLUDED.profile_name ELSE crm_whatsapp_identities.profile_name END,
   source=EXCLUDED.source,updated_at=now()`,[input.organizationId,input.waId,input.phoneE164,input.recordId,input.profileName,input.source]);
}

export async function lockWhatsAppIdentity(db:Db,organizationId:string,waId:string){
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${organizationId}:whatsapp:${waId}`]);
}

export async function syncWhatsAppRecordLinks(db:Db,input:{organizationId:string;recordId:string;numbers:string[];profileName:string;source:'manual'|'flow'}){
 const numbers=[...new Map(input.numbers.map(normalizeWhatsAppNumber).filter(item=>item.valid&&item.e164).map(item=>[item.digits,item])).values()].sort((a,b)=>a.digits.localeCompare(b.digits));
 for(const number of numbers){
  await lockWhatsAppIdentity(db,input.organizationId,number.digits);
  const matches=await candidates(db,input.organizationId,number.digits);if(matches.length!==1||matches[0]!==input.recordId)continue;
  const conversations=await db.query<{id:string;profile_name:string}>(`UPDATE whatsapp_conversations SET record_id=$3,link_status='identified',link_source=CASE WHEN link_source='manual' THEN 'manual' ELSE 'automatic' END,version=version+1,updated_at=now()
   WHERE organization_id=$1 AND external_wa_id=$2 AND (record_id IS NULL OR record_id=$3) RETURNING id,profile_name`,[input.organizationId,number.digits,input.recordId]);
  if(conversations.rowCount)await setWhatsAppIdentity(db,{organizationId:input.organizationId,waId:number.digits,phoneE164:number.e164!,recordId:input.recordId,profileName:conversations.rows[0].profile_name||input.profileName,source:input.source});
 }
}
