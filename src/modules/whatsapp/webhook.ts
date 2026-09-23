import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import type {PoolClient} from 'pg';
import {database,transaction} from '@/server/db';
import {AccessError} from '@/modules/auth/policy';
import {normalizeWhatsAppNumber} from './domain';
import {emitAutomationEvent} from '@/modules/automations/events';

type Db=Pick<PoolClient,'query'>;
type Json=Record<string,unknown>;
type Incoming={businessId:string;phoneNumberId:string;waId:string;profileName:string;id:string;timestamp:Date;type:string;body:string;preview:string;contextId:string;mediaId:string;mimeType:string;filename:string;caption:string;metadata:Json;status:'processed'|'unsupported';direction:'inbound'|'outbound';source:'messages'|'smb_message_echoes'};
type IncomingStatus={businessId:string;phoneNumberId:string;id:string;timestamp:Date;status:'sent'|'delivered'|'read'|'failed';failureCode:string;failureTitle:string;failureDetail:string};
const types=new Set(['text','image','document','audio','video','sticker','location','contacts','reaction','interactive']);
const object=(value:unknown):Json=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Json:{};
const text=(value:unknown,max:number)=>typeof value==='string'?value.slice(0,max):'';
const array=(value:unknown):unknown[]=>Array.isArray(value)?value:[];
export function validMetaSignature(raw:Uint8Array,signature:string|null,secret:string){if(!signature||!/^sha256=[0-9a-f]{64}$/i.test(signature))return false;const expected=createHmac('sha256',secret).update(raw).digest(),received=Buffer.from(signature.slice(7),'hex');return received.length===expected.length&&timingSafeEqual(received,expected);}
function parseMessage(entry:Json,value:Json,message:Json,direction:'inbound'|'outbound'='inbound'):Incoming{
 const metadata=object(value.metadata),phoneNumberId=text(metadata.phone_number_id,100),businessId=text(entry.id,100),id=text(message.id,180),waId=text(direction==='outbound'?message.to:message.from,30),rawTimestamp=text(message.timestamp,30),type=types.has(String(message.type))?String(message.type):'unknown',timestamp=new Date(Number(rawTimestamp)*1000);
 if(!phoneNumberId||!businessId||!id||!waId||!rawTimestamp||Number.isNaN(timestamp.getTime()))throw new AccessError(400,'Payload de webhook inválido.');
 const contact=direction==='inbound'?array(value.contacts).map(object).find(contact=>text(contact.wa_id,30)===waId):undefined,profileName=text(object(contact?.profile).name,180),contextId=text(object(message.context).id,240);let body='',preview='',mediaId='',mimeType='',filename='',caption='',safe:Json={},status:'processed'|'unsupported'='processed';
 if(type==='text'){body=text(object(message.text).body,16000);preview=body.slice(0,500);}
 else if(['image','document','audio','video','sticker'].includes(type)){const media=object(message[type]);mediaId=text(media.id,240);mimeType=text(media.mime_type,180);filename=text(media.filename,255);caption=text(media.caption,2000);const suffix=direction==='outbound'?'enviada':'recebida';preview=caption||({image:`Imagem ${suffix}`,document:`Documento ${direction==='outbound'?'enviado':'recebido'}`,audio:`Áudio ${direction==='outbound'?'enviado':'recebido'}`,video:`Vídeo ${direction==='outbound'?'enviado':'recebido'}`,sticker:`Figurinha ${suffix}`} as Record<string,string>)[type];safe={media_id:mediaId,mime_type:mimeType,filename,caption};}
 else if(type==='location'){const location=object(message.location),latitude=Number(location.latitude),longitude=Number(location.longitude);safe={...(Number.isFinite(latitude)?{latitude}:{}),...(Number.isFinite(longitude)?{longitude}:{}),name:text(location.name,180),address:text(location.address,500)};preview=text(location.name,180)||'Localização recebida';}
 else if(type==='contacts'){safe={count:array(message.contacts).length};preview='Contato recebido';}
 else if(type==='reaction'){const reaction=object(message.reaction);safe={message_id:text(reaction.message_id,240),emoji:text(reaction.emoji,20)};preview='Reação recebida';}
 else if(type==='interactive'){const interactive=object(message.interactive),reply=object(interactive.button_reply??interactive.list_reply);safe={interaction_type:text(interactive.type,40),reply_id:text(reply.id,180),title:text(reply.title,180)};preview=text(reply.title,180)||'Interação recebida';}
 else{preview='Mensagem não suportada';status='unsupported';}
 return {businessId,phoneNumberId,waId,profileName,id,timestamp,type,body,preview:preview.slice(0,500),contextId,mediaId,mimeType,filename,caption,metadata:safe,status,direction,source:direction==='outbound'?'smb_message_echoes':'messages'};
}
function parseStatus(entry:Json,value:Json,raw:Json):IncomingStatus|null{const status=text(raw.status,30);if(!['sent','delivered','read','failed'].includes(status))return null;const metadata=object(value.metadata),id=text(raw.id,240),phoneNumberId=text(metadata.phone_number_id,100),businessId=text(entry.id,100),timestamp=new Date(Number(text(raw.timestamp,30))*1000);if(!id||!phoneNumberId||!businessId||Number.isNaN(timestamp.getTime()))throw new AccessError(400,'Payload de webhook inválido.');const error=object(array(raw.errors)[0]);return {businessId,phoneNumberId,id,timestamp,status:status as IncomingStatus['status'],failureCode:text(error.code,80),failureTitle:text(error.title,180),failureDetail:text(object(error.error_data).details??error.message,500)};}
function extract(payload:unknown){const root=object(payload),messages:Incoming[]=[],statuses:IncomingStatus[]=[];if(root.object!=='whatsapp_business_account'||!Array.isArray(root.entry))return {messages,statuses};for(const rawEntry of root.entry){const entry=object(rawEntry);for(const rawChange of array(entry.changes)){const change=object(rawChange),value=object(change.value);if(change.field==='messages'){for(const rawMessage of array(value.messages))messages.push(parseMessage(entry,value,object(rawMessage)));for(const rawStatus of array(value.statuses)){const parsed=parseStatus(entry,value,object(rawStatus));if(parsed)statuses.push(parsed);}}else if(change.field==='smb_message_echoes'){for(const rawEcho of array(value.message_echoes))messages.push(parseMessage(entry,value,object(rawEcho),'outbound'));}}}return {messages,statuses};}
function parseSignedPayload(raw:Uint8Array,signature:string|null,secret:string){
 if(!validMetaSignature(raw,signature,secret))throw new AccessError(signature?403:401,'Assinatura do webhook inválida.');
 let payload:unknown;try{payload=JSON.parse(Buffer.from(raw).toString('utf8'));}catch{throw new AccessError(400,'Payload de webhook inválido.');}
 return {payload,incoming:extract(payload)};
}
async function resolveRecord(db:Db,organizationId:string,waId:string){const result=await db.query<{id:string}>(`SELECT DISTINCT r.id FROM crm_records r WHERE r.organization_id=$1 AND r.deleted_at IS NULL AND (r.phone=$2 OR r.whatsapp=$2 OR EXISTS(SELECT 1 FROM crm_record_contacts rc JOIN crm_contacts c ON c.organization_id=rc.organization_id AND c.id=rc.contact_id WHERE rc.organization_id=r.organization_id AND rc.record_id=r.id AND (c.phone=$2 OR c.whatsapp=$2))) ORDER BY r.id LIMIT 3`,[organizationId,waId]);return result.rows.length===1?{recordId:result.rows[0].id,status:'identified',source:'automatic'}:{recordId:null,status:result.rows.length>1?'ambiguous':'unidentified',source:'none'};}
export async function receiveMetaWebhook(raw:Uint8Array,signature:string|null,secret=process.env.WHATSAPP_APP_SECRET){
 if(!secret)throw new AccessError(503,'Webhook ainda não configurado.');
 const {incoming}=parseSignedPayload(raw,signature,secret);if(!incoming.messages.length&&!incoming.statuses.length)return {accepted:true,processed:0,duplicates:0};
 const hash=createHash('sha256').update(raw).digest('hex');
 return transaction(async db=>{
  let processed=0,duplicates=0;
  for(const message of incoming.messages){
   const normalized=normalizeWhatsAppNumber(message.waId.startsWith('+')?message.waId:'+'+message.waId);if(!normalized.valid)continue;
   const integration=await db.query<{organization_id:string;updated_by:string}>(`SELECT organization_id,updated_by FROM whatsapp_integrations WHERE phone_number_id=$1 AND business_account_id=$2 FOR UPDATE`,[message.phoneNumberId,message.businessId]);if(!integration.rowCount)continue;
   const organizationId=integration.rows[0].organization_id,eventType=`${message.source}.${message.type}`;
   const event=await db.query(`INSERT INTO whatsapp_webhook_events(organization_id,provider_event_id,event_type,payload_sha256,status,processed_at) VALUES ($1,$2,$3,$4,'processed',now()) ON CONFLICT(organization_id,provider_event_id) DO NOTHING RETURNING provider_event_id`,[organizationId,message.id,eventType,hash]);if(!event.rowCount){duplicates++;continue;}
   const match=await resolveRecord(db,organizationId,normalized.digits),lastInboundAt=message.direction==='inbound'?message.timestamp:null;
   const conversation=await db.query<{id:string;created:boolean;record_id:string|null;automation_owner_id:string|null}>(`INSERT INTO whatsapp_conversations(organization_id,external_wa_id,phone_e164,profile_name,record_id,link_status,link_source,last_inbound_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(organization_id,external_wa_id) DO UPDATE SET profile_name=CASE WHEN EXCLUDED.profile_name<>'' THEN EXCLUDED.profile_name ELSE whatsapp_conversations.profile_name END,record_id=CASE WHEN whatsapp_conversations.link_source='none' THEN EXCLUDED.record_id ELSE whatsapp_conversations.record_id END,link_status=CASE WHEN whatsapp_conversations.link_source='none' THEN EXCLUDED.link_status ELSE whatsapp_conversations.link_status END,link_source=CASE WHEN whatsapp_conversations.link_source='none' THEN EXCLUDED.link_source ELSE whatsapp_conversations.link_source END,last_inbound_at=GREATEST(COALESCE(whatsapp_conversations.last_inbound_at,EXCLUDED.last_inbound_at),EXCLUDED.last_inbound_at),updated_at=now() RETURNING id,(xmax=0) created,record_id,automation_owner_id`,[organizationId,normalized.digits,normalized.e164,message.profileName,match.recordId,match.status,match.source,lastInboundAt]);
   const conversationId=conversation.rows[0].id;
   const inserted=message.direction==='inbound'
    ?await db.query(`INSERT INTO whatsapp_messages(organization_id,conversation_id,meta_message_id,message_type,text_body,sender_wa_id,context_message_id,media_id,mime_type,filename,caption,safe_metadata,meta_timestamp,processing_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(organization_id,meta_message_id) DO NOTHING RETURNING id`,[organizationId,conversationId,message.id,message.type,message.body,normalized.digits,message.contextId,message.mediaId,message.mimeType,message.filename,message.caption,message.metadata,message.timestamp,message.status])
    :await db.query(`INSERT INTO whatsapp_messages(organization_id,conversation_id,meta_message_id,direction,message_type,text_body,sender_wa_id,context_message_id,media_id,mime_type,filename,caption,safe_metadata,meta_timestamp,processing_status,sent_by,client_request_id,delivery_status,sent_at,origin) VALUES ($1,$2,$3,'outbound',$4,$5,'',$6,$7,$8,$9,$10,$11,$12,$13,$14,gen_random_uuid(),'sent',$12,'manual') ON CONFLICT(organization_id,meta_message_id) DO NOTHING RETURNING id`,[organizationId,conversationId,message.id,message.type,message.body,message.contextId,message.mediaId,message.mimeType,message.filename,message.caption,message.metadata,message.timestamp,message.status,integration.rows[0].updated_by]);
   if(!inserted.rowCount){duplicates++;continue;}
   if(message.direction==='inbound'){
    await db.query(`UPDATE whatsapp_conversations SET unread_count=unread_count+1,last_message_preview=CASE WHEN last_message_at IS NULL OR last_message_at<=$3 THEN $4 ELSE last_message_preview END,last_message_type=CASE WHEN last_message_at IS NULL OR last_message_at<=$3 THEN $5 ELSE last_message_type END,last_message_at=GREATEST(COALESCE(last_message_at,$3),$3),last_inbound_at=GREATEST(COALESCE(last_inbound_at,$3),$3),version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2`,[organizationId,conversationId,message.timestamp,message.preview,message.type]);
    await emitAutomationEvent(db,{organizationId,type:'whatsapp.inbound_received',eventId:message.id,entityType:'conversation',entityId:conversationId,conversationId,recordId:conversation.rows[0].record_id,payload:{message_id:inserted.rows[0].id,direction:'inbound',message_type:message.type}});
    if(conversation.rows[0].created)await emitAutomationEvent(db,{organizationId,type:'whatsapp.conversation_created',eventId:`conversation:${conversationId}`,entityType:'conversation',entityId:conversationId,conversationId,recordId:conversation.rows[0].record_id});
    if(!conversation.rows[0].automation_owner_id)await emitAutomationEvent(db,{organizationId,type:'whatsapp.conversation_unassigned',eventId:`unassigned:${conversationId}:${message.id}`,entityType:'conversation',entityId:conversationId,conversationId,recordId:conversation.rows[0].record_id});
   }else await db.query(`UPDATE whatsapp_conversations SET last_message_preview=CASE WHEN last_message_at IS NULL OR last_message_at<=$3 THEN $4 ELSE last_message_preview END,last_message_type=CASE WHEN last_message_at IS NULL OR last_message_at<=$3 THEN $5 ELSE last_message_type END,last_message_at=GREATEST(COALESCE(last_message_at,$3),$3),version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2`,[organizationId,conversationId,message.timestamp,message.preview,message.type]);
   await db.query(`UPDATE whatsapp_integrations SET status='connected',webhook_status='receiving',last_event_at=now(),last_event_type=$2,updated_at=now() WHERE organization_id=$1`,[organizationId,eventType]);processed++;
  }
  for(const status of incoming.statuses){
   const integration=await db.query<{organization_id:string}>(`SELECT organization_id FROM whatsapp_integrations WHERE phone_number_id=$1 AND business_account_id=$2 FOR UPDATE`,[status.phoneNumberId,status.businessId]);if(!integration.rowCount)continue;
   const organizationId=integration.rows[0].organization_id,eventId='status:'+createHash('sha256').update(`${status.id}|${status.status}|${status.timestamp.toISOString()}`).digest('hex'),event=await db.query(`INSERT INTO whatsapp_webhook_events(organization_id,provider_event_id,event_type,payload_sha256,status,processed_at) VALUES ($1,$2,$3,$4,'processed',now()) ON CONFLICT(organization_id,provider_event_id) DO NOTHING RETURNING provider_event_id`,[organizationId,eventId,`statuses.${status.status}`,hash]);if(!event.rowCount){duplicates++;continue;}
   await db.query(`UPDATE whatsapp_messages SET delivery_status=CASE WHEN $3='read' THEN 'read' WHEN $3='delivered' AND delivery_status IN ('pending','sent','delivered') THEN 'delivered' WHEN $3='sent' AND delivery_status IN ('pending','sent') THEN 'sent' WHEN $3='failed' AND delivery_status IN ('pending','sent') THEN 'failed' ELSE delivery_status END,sent_at=CASE WHEN $3='sent' THEN COALESCE(sent_at,$4) ELSE sent_at END,delivered_at=CASE WHEN $3='delivered' THEN COALESCE(delivered_at,$4) ELSE delivered_at END,read_at=CASE WHEN $3='read' THEN COALESCE(read_at,$4) ELSE read_at END,failed_at=CASE WHEN $3='failed' AND delivery_status IN ('pending','sent') THEN COALESCE(failed_at,$4) ELSE failed_at END,failure_code=CASE WHEN $3='failed' THEN $5 ELSE failure_code END,failure_title=CASE WHEN $3='failed' THEN $6 ELSE failure_title END,failure_detail=CASE WHEN $3='failed' THEN $7 ELSE failure_detail END,outcome_uncertain=false WHERE organization_id=$1 AND meta_message_id=$2 AND direction='outbound'`,[organizationId,status.id,status.status,status.timestamp,status.failureCode,status.failureTitle,status.failureDetail]);
   await db.query(`UPDATE whatsapp_integrations SET last_event_at=now(),last_event_type=$2,updated_at=now() WHERE organization_id=$1`,[organizationId,`statuses.${status.status}`]);processed++;
  }
  return {accepted:true,processed,duplicates};
 });
}

type WebhookBatch={id:string;raw_payload:string;signature:string;attempts:number};
export async function enqueueMetaWebhook(raw:Uint8Array,signature:string|null,secret=process.env.WHATSAPP_APP_SECRET){
 if(!secret)throw new AccessError(503,'Webhook ainda não configurado.');
 const {incoming}=parseSignedPayload(raw,signature,secret);
 if(!incoming.messages.length&&!incoming.statuses.length)return {accepted:true,queued:0,duplicates:0,batchIds:[] as string[]};
 const pairs=new Map<string,{phoneNumberId:string;businessId:string}>();
 for(const event of [...incoming.messages,...incoming.statuses])pairs.set(`${event.phoneNumberId}:${event.businessId}`,event);
 const organizations=new Set<string>();
 for(const pair of pairs.values()){
  const found=await database().query<{organization_id:string}>('SELECT organization_id FROM whatsapp_integrations WHERE phone_number_id=$1 AND business_account_id=$2',[pair.phoneNumberId,pair.businessId]);
  if(found.rows[0])organizations.add(found.rows[0].organization_id);
 }
 if(!organizations.size)return {accepted:true,queued:0,duplicates:0,batchIds:[] as string[]};
 if(organizations.size!==1)throw new AccessError(400,'Payload de webhook inválido.');
 const organizationId=[...organizations][0],hash=createHash('sha256').update(raw).digest('hex'),rawPayload=Buffer.from(raw).toString('utf8');
 const inserted=await database().query<{id:string}>(`INSERT INTO whatsapp_webhook_batches(organization_id,payload_sha256,raw_payload,signature) VALUES ($1,$2,$3,$4) ON CONFLICT(organization_id,payload_sha256) DO NOTHING RETURNING id`,[organizationId,hash,rawPayload,signature]);
 if(inserted.rows[0])return {accepted:true,queued:1,duplicates:0,batchIds:[inserted.rows[0].id]};
 return {accepted:true,queued:0,duplicates:1,batchIds:[] as string[]};
}

export async function processMetaWebhookBatches(limit=20,ids?:string[],secret=process.env.WHATSAPP_APP_SECRET){
 if(!secret)throw new AccessError(503,'Webhook ainda não configurado.');
 await database().query(`UPDATE whatsapp_webhook_batches SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,locked_at=NULL,scheduled_for=now()+interval '5 minutes',safe_error='webhook_batch_stale',updated_at=now() WHERE status='processing' AND locked_at<now()-interval '10 minutes'`);
 const jobs=await transaction(async db=>{const result=await db.query<WebhookBatch>(`SELECT id,raw_payload,signature,attempts FROM whatsapp_webhook_batches WHERE status='pending' AND scheduled_for<=now() AND ($2::uuid[] IS NULL OR id=ANY($2::uuid[])) ORDER BY scheduled_for,id FOR UPDATE SKIP LOCKED LIMIT $1`,[limit,ids?.length?ids:null]);if(result.rowCount)await db.query("UPDATE whatsapp_webhook_batches SET status='processing',attempts=attempts+1,locked_at=now(),updated_at=now() WHERE id=ANY($1::uuid[])",[result.rows.map(row=>row.id)]);return result.rows.map(row=>({...row,attempts:row.attempts+1}));});
 let completed=0;
 for(const job of jobs){try{await receiveMetaWebhook(Buffer.from(job.raw_payload,'utf8'),job.signature,secret);await database().query("UPDATE whatsapp_webhook_batches SET status='completed',locked_at=NULL,completed_at=now(),safe_error='',raw_payload='',signature='sha256='||repeat('0',64),updated_at=now() WHERE id=$1",[job.id]);completed++;}catch(error){const terminal=job.attempts>=5;await database().query(`UPDATE whatsapp_webhook_batches SET status=$2,locked_at=NULL,scheduled_for=now()+make_interval(mins=>$3::int),safe_error='webhook_processing_failed',updated_at=now() WHERE id=$1`,[job.id,terminal?'failed':'pending',job.attempts*5]);console.error('whatsapp_webhook_processing_failed',{type:error instanceof Error?error.name:'unknown'});}}
 return {processed:jobs.length,completed};
}
