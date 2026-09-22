import {createHash} from 'node:crypto';
import {z} from 'zod';
import {database} from '@/server/db';
import {AccessError,type Actor} from '@/modules/auth/policy';
import {assertWhatsAppConversation} from './inbox';
import {fetchMetaMedia,metaConfiguration,type MetaFetcher} from './meta';

const uuid=z.uuid();
export const MEDIA_REQUEST_LIMIT=10*1024*1024+32*1024;
type MediaKind='image'|'document';
type PreparedMedia={kind:MediaKind;file:File;mimeType:string;filename:string;caption:string;sha256:string;size:number};
const cleanName=(name:string)=>name.replace(/[\x00-\x1f\x7f\\/]/g,'_').trim().slice(0,180)||'anexo';
export async function prepareWhatsAppMedia(file:File,caption:unknown):Promise<PreparedMedia>{
 if(!(file instanceof File)||file.size===0)throw new AccessError(400,'Selecione um arquivo.');
 const mimeType=file.type.toLowerCase().split(';')[0],kind:MediaKind=mimeType==='application/pdf'?'document':'image';
 if(!['application/pdf','image/jpeg','image/png'].includes(mimeType))throw new AccessError(415,'Envie uma imagem JPEG/PNG ou um PDF.');
 const extension=mimeType==='application/pdf'?/\.pdf$/i:mimeType==='image/png'?/\.png$/i:/\.(jpg|jpeg)$/i;
 if(!extension.test(file.name))throw new AccessError(415,'A extensão do arquivo não corresponde ao formato informado.');
 const max=kind==='image'?5*1024*1024:10*1024*1024;if(file.size>max)throw new AccessError(413,`O arquivo excede ${kind==='image'?'5':'10'} MB.`);
 const head=new Uint8Array(await file.slice(0,12).arrayBuffer());
 const signature=mimeType==='application/pdf'?[37,80,68,70,45]:mimeType==='image/png'?[137,80,78,71,13,10,26,10]:[255,216,255];
 if(!signature.every((byte,index)=>head[index]===byte))throw new AccessError(415,'O conteúdo do arquivo não corresponde ao formato informado.');
 if(typeof caption!=='string'||caption.trim().length>2000)throw new AccessError(400,'Legenda inválida.');
 const filename=cleanName(file.name),bytes=Buffer.from(await file.arrayBuffer());
 return {kind,file:new File([bytes],filename,{type:mimeType}),mimeType,filename,caption:caption.trim(),sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length};
}
export type {PreparedMedia};

function presentationType(kind:string,mime:string){const type=mime.toLowerCase().split(';')[0];
 if(kind==='image'&&['image/jpeg','image/png','image/webp'].includes(type))return type;
 if(kind==='audio'&&['audio/ogg','audio/mpeg','audio/mp4','audio/aac','audio/amr','audio/webm'].includes(type))return type;
 if(kind==='video'&&['video/mp4','video/3gpp'].includes(type))return type;
 if(kind==='document'&&type==='application/pdf')return type;
 return 'application/octet-stream';
}
export async function whatsappMediaResponse(actor:Actor,conversationId:string,messageId:string,range:string|null,fetcher?:MetaFetcher){
 uuid.parse(messageId);await assertWhatsAppConversation(actor,conversationId);
 const result=await database().query<{media_id:string;message_type:string;mime_type:string;filename:string}>(`SELECT media_id,message_type,mime_type,filename FROM whatsapp_messages WHERE organization_id=$1 AND conversation_id=$2 AND id=$3 AND message_type IN ('audio','image','document','video','sticker')`,[actor.organizationId,conversationId,messageId]);
 const message=result.rows[0];if(!message?.media_id)throw new AccessError(404,'Mídia não encontrada.');
 const integration=await database().query<{status:string;api_version:string;phone_number_id:string;business_account_id:string}>(`SELECT status,api_version,phone_number_id,business_account_id FROM whatsapp_integrations WHERE organization_id=$1`,[actor.organizationId]);
 if(integration.rows[0]?.status!=='connected')throw new AccessError(503,'A integração do WhatsApp não está conectada.');
 const parsedRange=range&&/^bytes=\d*-\d*$/.test(range)?range:null;
 const {response,mimeType}=await fetchMetaMedia(metaConfiguration(integration.rows[0]),message.media_id,parsedRange,fetcher);
 const type=presentationType(message.message_type,mimeType||message.mime_type),filename=cleanName(message.filename||`${message.message_type}.${type.split('/')[1]||'bin'}`);
 const inline=type!=='application/octet-stream'&&message.message_type!=='document';
 const headers=new Headers({'Content-Type':type,'Content-Disposition':`${inline?'inline':'attachment'}; filename="${filename.replace(/[^\x20-\x7e]/g,'_').replace(/"/g,'_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"});
 for(const key of ['content-length','content-range','accept-ranges']){const value=response.headers.get(key);if(value)headers.set(key,value);}
 return new Response(response.body,{status:response.status,headers});
}
