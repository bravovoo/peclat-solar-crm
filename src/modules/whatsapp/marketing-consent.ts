import type {PoolClient} from 'pg';

type Db=Pick<PoolClient,'query'>;
type ConsentContext={organizationId:string;recordId:string;conversationId:string;messageId:string;actorId:string;timestamp:Date};
const normalize=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9+]+/g,' ').trim().replace(/\s+/g,' ');
const affirmative=new Set(['sim','sim autorizo','sim eu autorizo','aceito','eu aceito','autorizo','concordo','pode enviar','quero receber','quero sim']);

/** Requires the business name, WhatsApp, a permission request, and an ongoing message category. */
export function isExplicitWhatsAppMarketingPrompt(value:string){
 const text=normalize(value);
 return text.length<=4000&&text.includes('peclat solar')&&/\bwhats ?app\b/.test(text)&&
  /\b(autoriza|autorizacao|consente|consentimento|concorda|aceita|permite|podemos)\b/.test(text)&&
  /\b(receber|receba|enviar|enviaremos)\b/.test(text)&&/\b(mensagem|mensagens)\b/.test(text)&&
  /\b(futura|futuras|mais|acompanhamento|novidade|novidades|oferta|ofertas|proposta|propostas|orcamento|orcamentos)\b/.test(text);
}

export function isAffirmativeWhatsAppConsent(value:string){return affirmative.has(normalize(value));}

function optInFields(value:unknown):{name:string;label:string}[]{
 if(!value||typeof value!=='object')return [];
 if(Array.isArray(value))return value.flatMap(optInFields);
 const item=value as Record<string,unknown>,found=item.type==='OptIn'&&typeof item.name==='string'&&typeof item.label==='string'?[{name:item.name,label:item.label}]:[];
 return [...found,...Object.values(item).flatMap(optInFields)];
}

function explicitOptInLabel(value:string){
 const text=normalize(value);
 return text.length>0&&text.length<=120&&text.includes('peclat solar')&&/\bwhats ?app\b/.test(text)&&
  /\b(receber|receba|mensagens?)\b/.test(text)&&
  /\b(futura|futuras|mais|acompanhamento|novidade|novidades|oferta|ofertas|proposta|propostas|orcamento|orcamentos)\b/.test(text);
}

/** Only a true Meta OptIn field in the exact Flow sent from this CRM is evidence. */
export function hasExplicitFlowMarketingOptIn(flowJson:unknown,response:Record<string,unknown>){
 return optInFields(flowJson).some(field=>explicitOptInLabel(field.label)&&(response[field.name]===true||response[field.name]==='true'));
}

async function recordOptIn(db:Db,input:ConsentContext,source:string){
 const result=await db.query(`INSERT INTO crm_contact_preferences(organization_id,record_id,whatsapp_consent_status,consent_source,consented_at,opted_out_at,updated_by)
  VALUES ($1,$2,'opted_in',$3,$4,NULL,$5)
  ON CONFLICT(organization_id,record_id) DO UPDATE SET whatsapp_consent_status='opted_in',consent_source=EXCLUDED.consent_source,consented_at=EXCLUDED.consented_at,opted_out_at=NULL,updated_by=EXCLUDED.updated_by,version=crm_contact_preferences.version+1,updated_at=now()
  WHERE (crm_contact_preferences.whatsapp_consent_status<>'opted_out' OR crm_contact_preferences.opted_out_at<EXCLUDED.consented_at)
    AND (crm_contact_preferences.whatsapp_consent_status<>'opted_in' OR crm_contact_preferences.consented_at<=EXCLUDED.consented_at)
  RETURNING record_id`,[input.organizationId,input.recordId,source,input.timestamp,input.actorId]);
 if(!result.rowCount)return false;
 await db.query(`INSERT INTO audit_logs(organization_id,actor_id,action,detail) VALUES ($1,$2,'whatsapp.marketing_opt_in_verified',$3)`,[input.organizationId,input.actorId,`Consentimento WhatsApp verificado para lead ${input.recordId}; evidência ${source}; mensagem ${input.messageId}.`]);
 return true;
}

/** A contextual positive answer only counts when it directly quotes a strict, explicit outbound consent request. */
export async function captureContextualWhatsAppOptIn(db:Db,input:ConsentContext&{contextMessageId:string;reply:string}){
 if(!input.contextMessageId||!isAffirmativeWhatsAppConsent(input.reply))return false;
 const prompt=await db.query<{text_body:string;direction:string}>(`SELECT text_body,direction FROM whatsapp_messages WHERE organization_id=$1 AND conversation_id=$2 AND meta_message_id=$3 AND direction='outbound' LIMIT 1`,[input.organizationId,input.conversationId,input.contextMessageId]);
 if(!prompt.rows[0]||!isExplicitWhatsAppMarketingPrompt(prompt.rows[0].text_body))return false;
 return recordOptIn(db,input,'Resposta afirmativa contextual a pedido explícito de WhatsApp da Peclat Solar');
}

export async function captureFlowWhatsAppOptIn(db:Db,input:ConsentContext&{flowJson:unknown;flowName:string;response:Record<string,unknown>}){
 if(!hasExplicitFlowMarketingOptIn(input.flowJson,input.response))return false;
 return recordOptIn(db,input,`WhatsApp Flow ${input.flowName}: OptIn explícito`);
}

/** One-time, organization-scoped reconciliation for explicit contextual opt-ins already stored before this feature shipped. Call inside a transaction. */
export async function reconcileHistoricalWhatsAppOptIns(db:Db,organizationId:string){
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${organizationId}:whatsapp-opt-in-history`]);
 const completed=await db.query('SELECT 1 FROM audit_logs WHERE organization_id=$1 AND action=\'whatsapp.marketing_opt_in_history_scanned\' LIMIT 1',[organizationId]);
 if(completed.rowCount)return {scanned:false,registered:0};
 const integration=await db.query<{updated_by:string}>('SELECT updated_by FROM whatsapp_integrations WHERE organization_id=$1',[organizationId]);
 if(!integration.rows[0])return {scanned:false,registered:0};
 const evidence=await db.query<{record_id:string;conversation_id:string;message_id:string;timestamp:Date;context_message_id:string;prompt:string;reply:string}>(`SELECT r.id record_id,c.id conversation_id,inbound.meta_message_id message_id,inbound.meta_timestamp timestamp,inbound.context_message_id,
  outbound.text_body prompt,CASE WHEN inbound.message_type='interactive' THEN COALESCE(inbound.safe_metadata->>'title','') ELSE inbound.text_body END reply
  FROM whatsapp_messages inbound
  JOIN whatsapp_messages outbound ON outbound.organization_id=inbound.organization_id AND outbound.meta_message_id=inbound.context_message_id AND outbound.conversation_id=inbound.conversation_id AND outbound.direction='outbound'
  JOIN whatsapp_conversations c ON c.organization_id=inbound.organization_id AND c.id=inbound.conversation_id AND c.record_id IS NOT NULL
  JOIN crm_records r ON r.organization_id=c.organization_id AND r.id=c.record_id AND r.kind='lead'
  LEFT JOIN crm_contact_preferences preference ON preference.organization_id=r.organization_id AND preference.record_id=r.id
  WHERE inbound.organization_id=$1 AND inbound.direction='inbound' AND inbound.message_type IN ('text','interactive') AND inbound.context_message_id<>''
   AND (preference.whatsapp_consent_status IS DISTINCT FROM 'opted_in' OR preference.consented_at<inbound.meta_timestamp)
  ORDER BY inbound.meta_timestamp,inbound.id`,[organizationId]);
 let registered=0;
 for(const row of evidence.rows){
  if(!isExplicitWhatsAppMarketingPrompt(row.prompt)||!isAffirmativeWhatsAppConsent(row.reply))continue;
  const saved=await recordOptIn(db,{organizationId,recordId:row.record_id,conversationId:row.conversation_id,messageId:row.message_id,actorId:integration.rows[0].updated_by,timestamp:new Date(row.timestamp)},'Resposta afirmativa contextual verificada no histórico do WhatsApp');
  if(saved)registered++;
 }
 await db.query(`INSERT INTO audit_logs(organization_id,actor_id,action,detail) VALUES ($1,$2,'whatsapp.marketing_opt_in_history_scanned',$3)`,[organizationId,integration.rows[0].updated_by,`Reconciliação única do histórico concluída; ${registered} evidência(s) explícita(s) registrada(s).`]);
 return {scanned:true,registered};
}
