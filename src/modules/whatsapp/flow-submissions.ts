import type {PoolClient} from 'pg';
import {emitAutomationEvent} from '@/modules/automations/events';
import {emptyNormalizedFlow,type NormalizedFlowSubmission} from './flow-domain';
import {setWhatsAppIdentity} from './contact-identity';
import {captureFlowWhatsAppOptIn} from './marketing-consent';

type Db=Pick<PoolClient,'query'>;
type Input={organizationId:string;conversationId:string;messageId:string;providerSubmissionId:string;contextMessageId:string;waId:string;actorId:string;timestamp:Date;response:Record<string,unknown>};
type Flow={id:string;display_name:string;technical_name:string;flow_json:Record<string,unknown>};
type RecordMatch={id:string;kind:'lead'|'customer'|'company'};
type ProcessingResult='lead_created'|'lead_updated'|'customer_linked'|'company_linked'|'ambiguous_contact'|'invalid_data';
const text=(value:unknown,max:number)=>typeof value==='string'?value.trim().slice(0,max):'';
const choiceLabels:Record<string,Record<string,string>>={
 property_type:{'1':'Residencial','2':'Comercial','3':'Industrial','4':'Rural','5':'Condomínio','6':'Outro'},
 has_bill:{'1':'Sim','2':'Não'},property_owned:{'1':'Sim','2':'Não'},
 commercial_interest:{'1':'Reduzir a conta de energia','2':'Financiar o sistema','3':'Comprar à vista','4':'Sistema com baterias','5':'Sistema para empresa','6':'Ainda estou pesquisando'},
 technical_visit:{'1':'Sim','2':'Não','3':'Quero conversar primeiro'},preferred_contact_period:{'1':'Manhã','2':'Tarde','3':'Noite'}
};
function mappedValue(target:string,value:unknown){const raw=text(value,target==='observations'?2000:180);return choiceLabels[target]?.[raw]??raw;}
function safeAudit(response:Record<string,unknown>){const allowed=['full_name','city','state','property_type','average_bill','has_bill','property_owned','commercial_interest','technical_visit','preferred_contact_period','observations'];return Object.fromEntries(allowed.map(key=>[key,typeof response[key]==='string'?text(response[key],key==='observations'?2000:180):'']));}
function summary(value:NormalizedFlowSubmission){return {name:value.name,city:value.city,state:value.state,property_type:value.property_type,average_bill:value.average_bill,has_bill:value.has_bill,property_owned:value.property_owned,commercial_interest:value.commercial_interest,technical_visit:value.technical_visit,preferred_contact_period:value.preferred_contact_period};}
function complete(value:NormalizedFlowSubmission){return Boolean(value.name&&value.city&&value.state&&value.property_type&&value.average_bill!==null&&value.has_bill&&value.property_owned&&value.commercial_interest&&value.technical_visit&&value.preferred_contact_period);}
async function ensureTag(db:Db,organizationId:string,name:string,color:string){await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${organizationId}:crm-tag:${name.toLowerCase()}`]);const found=await db.query<{id:string}>('SELECT id FROM crm_tags WHERE organization_id=$1 AND lower(name)=lower($2) LIMIT 1',[organizationId,name]);if(found.rowCount)return found.rows[0].id;const count=await db.query<{total:number}>('SELECT count(*)::int total FROM crm_tags WHERE organization_id=$1',[organizationId]);if(Number(count.rows[0].total)>=500)return null;return (await db.query<{id:string}>('INSERT INTO crm_tags(organization_id,name,color) VALUES ($1,$2,$3) RETURNING id',[organizationId,name,color])).rows[0].id;}
async function flowForReply(db:Db,input:Input,flowToken:string){const result=await db.query<Flow>(`SELECT f.id,f.display_name,f.technical_name,f.flow_json FROM whatsapp_flows f WHERE f.organization_id=$1 AND EXISTS(SELECT 1 FROM whatsapp_messages m WHERE m.organization_id=f.organization_id AND m.conversation_id=$4 AND m.direction='outbound' AND m.message_type='interactive' AND m.safe_metadata->>'flow_id'=f.id::text AND (($2<>'' AND m.safe_metadata->>'flow_token'=$2 AND ($3='' OR m.meta_message_id=$3)) OR ($2='' AND $3<>'' AND m.meta_message_id=$3))) ORDER BY f.updated_at DESC LIMIT 1`,[input.organizationId,flowToken,input.contextMessageId,input.conversationId]);return result.rows[0]??null;}
function billAmount(value:string){
 const raw=value.trim().replace(/^R\$\s*/,'');
 if(!/^(?:\d+(?:[.,]\d{1,2})?|\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?)$/.test(raw))return null;
 const normalized=raw.includes(',')?raw.replaceAll('.','').replace(',','.'): /^\d{1,3}(?:\.\d{3})+$/.test(raw)?raw.replaceAll('.',''):raw;
 const amount=Number(normalized);return Number.isFinite(amount)&&amount>=0&&amount<=9999999999.99?amount:null;
}

export async function processFlowSubmission(db:Db,input:Input){
 const flowToken=text(input.response.flow_token,500),flow=await flowForReply(db,input,flowToken);if(!flow)return null;
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${input.organizationId}:flow-submission:${input.providerSubmissionId}`]);
 const duplicate=await db.query<{id:string;record_id:string|null;processing_result:ProcessingResult;normalized_payload:NormalizedFlowSubmission}>('SELECT id,record_id,processing_result,normalized_payload FROM whatsapp_flow_submissions WHERE organization_id=$1 AND provider_submission_id=$2',[input.organizationId,input.providerSubmissionId]);
 if(duplicate.rowCount)return {id:duplicate.rows[0].id,recordId:duplicate.rows[0].record_id,result:duplicate.rows[0].processing_result,normalized:duplicate.rows[0].normalized_payload,flow};

 const mappings=await db.query<{flow_field:string;crm_field:keyof NormalizedFlowSubmission}>(`SELECT flow_field,crm_field FROM whatsapp_flow_field_mappings WHERE organization_id=$1 AND flow_id=$2 AND enabled ORDER BY id`,[input.organizationId,flow.id]),normalized=emptyNormalizedFlow();
 for(const mapping of mappings.rows){const value=mappedValue(mapping.crm_field,input.response[mapping.flow_field]);if(mapping.crm_field==='average_bill')normalized.average_bill=billAmount(value);else normalized[mapping.crm_field]=value as never;}
 normalized.state=normalized.state.toUpperCase().slice(0,2);if(!/^[A-Z]{2}$/.test(normalized.state))normalized.state='';

 const conversation=await db.query<{record_id:string|null}>(`SELECT record_id FROM whatsapp_conversations WHERE organization_id=$1 AND id=$2 FOR UPDATE`,[input.organizationId,input.conversationId]);
 let recordId:string|null=null,result:ProcessingResult='invalid_data';
 if(complete(normalized)){
  const linkedId=conversation.rows[0]?.record_id??null;
  let matches:RecordMatch[]=[];
  if(linkedId)matches=(await db.query<RecordMatch>('SELECT id,kind FROM crm_records WHERE organization_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE',[input.organizationId,linkedId])).rows;
  else matches=(await db.query<RecordMatch>(`SELECT id,kind FROM crm_records WHERE organization_id=$1 AND deleted_at IS NULL AND $2 IN (crm_normalize_whatsapp_number(phone),crm_normalize_whatsapp_number(whatsapp)) ORDER BY id LIMIT 2 FOR UPDATE`,[input.organizationId,input.waId])).rows;
  if(matches.length>1)result='ambiguous_contact';
  else if(!matches.length){
   const detail=details(flow,normalized);
   const created=await db.query<{id:string}>(`INSERT INTO crm_records(organization_id,owner_id,kind,name,phone,whatsapp,city,state,source,stage,property_type,financing_interest,battery_interest,observations) VALUES ($1,NULL,'lead',$2,$3,$3,$4,$5,'WhatsApp Flow','new',$6,$7,$8,$9) RETURNING id`,[input.organizationId,normalized.name,input.waId,normalized.city,normalized.state,normalized.property_type,normalized.commercial_interest==='Financiar o sistema',normalized.commercial_interest==='Sistema com baterias',detail]);
   recordId=created.rows[0].id;result='lead_created';
   await emitAutomationEvent(db,{organizationId:input.organizationId,type:'lead.created',eventId:`flow:${input.providerSubmissionId}:lead`,entityType:'record',entityId:recordId,recordId,payload:{owner_id:null,stage:'new',source:'WhatsApp Flow'}});
  }else{
   recordId=matches[0].id;
   if(matches[0].kind==='lead'){
    await db.query(`UPDATE crm_records SET name=CASE WHEN source='WhatsApp' OR lower(name) IN ('contato whatsapp','não identificada') THEN $3 ELSE name END,source=CASE WHEN source='WhatsApp' THEN 'WhatsApp Flow' ELSE source END,city=CASE WHEN city='' THEN $4 ELSE city END,state=CASE WHEN state='' THEN $5 ELSE state END,property_type=CASE WHEN property_type='' THEN $6 ELSE property_type END,financing_interest=financing_interest OR $7,battery_interest=battery_interest OR $8,observations=CASE WHEN observations='' THEN $9 ELSE left(observations||E'\n\n'||$9,4000) END,version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2`,[input.organizationId,recordId,normalized.name,normalized.city,normalized.state,normalized.property_type,normalized.commercial_interest==='Financiar o sistema',normalized.commercial_interest==='Sistema com baterias',details(flow,normalized)]);result='lead_updated';
   }else result=matches[0].kind==='customer'?'customer_linked':'company_linked';
  }
 }

 if(recordId){
  await setWhatsAppIdentity(db,{organizationId:input.organizationId,waId:input.waId,phoneE164:`+${input.waId}`,recordId,profileName:normalized.name,source:'flow'});
  await captureFlowWhatsAppOptIn(db,{organizationId:input.organizationId,recordId,conversationId:input.conversationId,messageId:input.providerSubmissionId,actorId:input.actorId,timestamp:input.timestamp,flowJson:flow.flow_json,flowName:flow.technical_name,response:input.response});
  for(const [name,color,enabled] of [['WhatsApp Flow','#20a77a',true],['Orçamento Solar','#d8a422',true],['Financiamento','#376bc7',normalized.commercial_interest==='Financiar o sistema'],['Visita Técnica','#8b5cf6',normalized.technical_visit==='Sim']] as const){if(!enabled)continue;const tagId=await ensureTag(db,input.organizationId,name,color);if(tagId)await db.query('INSERT INTO crm_record_tags(organization_id,record_id,tag_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',[input.organizationId,recordId,tagId]);}
 }
 const submission=await db.query<{id:string}>(`INSERT INTO whatsapp_flow_submissions(organization_id,flow_id,conversation_id,message_id,record_id,provider_submission_id,flow_token,normalized_payload,audit_payload,processing_result) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,[input.organizationId,flow.id,input.conversationId,input.messageId,recordId,input.providerSubmissionId,flowToken,JSON.stringify(normalized),JSON.stringify(safeAudit(input.response)),result]);
 await db.query(`UPDATE whatsapp_messages SET flow_submission_id=$3,safe_metadata=safe_metadata||$4::jsonb,text_body='Formulário preenchido: '||$5 WHERE organization_id=$1 AND id=$2`,[input.organizationId,input.messageId,submission.rows[0].id,JSON.stringify({flow_submission:{id:submission.rows[0].id,flow_id:flow.id,flow_name:flow.display_name,record_id:recordId,processing_result:result,summary:summary(normalized)}}),flow.display_name]);
 if(recordId)await db.query(`UPDATE whatsapp_conversations SET record_id=$3,link_status='identified',link_source=CASE WHEN record_id IS NULL THEN 'automatic' ELSE link_source END,last_message_preview='Formulário de orçamento preenchido',version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2`,[input.organizationId,input.conversationId,recordId]);
 else await db.query(`UPDATE whatsapp_conversations SET last_message_preview='Formulário de orçamento preenchido',version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2`,[input.organizationId,input.conversationId]);
 if(recordId)await db.query(`INSERT INTO crm_activities(organization_id,record_id,actor_id,action,detail) VALUES ($1,$2,$3,'whatsapp.flow.submitted',$4)`,[input.organizationId,recordId,input.actorId,`Formulário ${flow.display_name} preenchido pelo WhatsApp.`]);
 await db.query(`INSERT INTO audit_logs(organization_id,actor_id,action,detail) VALUES ($1,$2,'whatsapp.flow_submission_processed',$3)`,[input.organizationId,input.actorId,`Flow ${flow.id}; submissão ${submission.rows[0].id}; resultado ${result}.`]);
 return {id:submission.rows[0].id,recordId,result,normalized,flow};
}

function details(flow:Flow,value:NormalizedFlowSubmission){return [`Flow: ${flow.display_name}`,`Conta média: R$ ${value.average_bill!.toFixed(2)}`,`Possui fatura: ${value.has_bill}`,`Imóvel próprio: ${value.property_owned}`,`Interesse: ${value.commercial_interest}`,`Visita técnica: ${value.technical_visit}`,`Melhor período: ${value.preferred_contact_period}`,value.observations?`Observações: ${value.observations}`:''].filter(Boolean).join('\n').slice(0,4000);}
