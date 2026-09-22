import {NextResponse} from 'next/server';
import {z} from 'zod';
import {apiActor} from '@/server/session';
import {failure,readMultipartMutation,readMutation} from '@/server/http';
import {AccessError} from '@/modules/auth/policy';
import {createLeadFromWhatsApp,getWhatsAppConversation,linkWhatsAppConversation,listWhatsAppConversations,markWhatsAppConversationRead,searchWhatsAppLinkOptions,WhatsAppLeadDuplicateError} from '@/modules/whatsapp/inbox';
import {sendWhatsAppMedia,sendWhatsAppTemplate,sendWhatsAppText} from '@/modules/whatsapp/outbound';
import {MEDIA_REQUEST_LIMIT,whatsappMediaResponse} from '@/modules/whatsapp/media';
import {automationConversationInput} from '@/modules/automations/domain';
import {updateConversationAutomation} from '@/modules/automations/repository';

type Context={params:Promise<{segments?:string[]}>};
const respond=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'no-store'}});
async function handle(request:Request,context:Context){
 try{
  const actor=await apiActor(),url=new URL(request.url),query=Object.fromEntries(url.searchParams),[id,action,...rest]=(await context.params).segments??[];
  if(request.method==='GET'&&id&&action==='messages'&&rest.length===2&&rest[1]==='media')return await whatsappMediaResponse(actor,id,rest[0],request.headers.get('range'));
  if(rest.length)throw new AccessError(404,'Recurso não encontrado.');
  if(request.method==='GET'&&!id)return respond(await listWhatsAppConversations(actor,query));
  if(request.method==='GET'&&id==='records'&&!action)return respond(await searchWhatsAppLinkOptions(actor,z.string().max(120).parse(query.q??'')));
  if(request.method==='GET'&&id&&!action)return respond(await getWhatsAppConversation(actor,id,z.coerce.number().int().min(1).max(100000).parse(query.page??1)));
  if(request.method==='POST'&&id&&action==='read')return respond(await markWhatsAppConversationRead(actor,id,await readMutation(request)));
  if(request.method==='POST'&&id&&action==='create-lead')return respond(await createLeadFromWhatsApp(actor,id,await readMutation(request)),201);
  if(request.method==='POST'&&id&&action==='messages')return respond(await sendWhatsAppText(actor,id,await readMutation(request)));
  if(request.method==='POST'&&id&&action==='media'){
   const form=await readMultipartMutation(request,MEDIA_REQUEST_LIMIT);
   if([...form.keys()].some(key=>!['client_request_id','caption','file'].includes(key))||form.getAll('file').length!==1)throw new AccessError(400,'Campos de anexo inválidos.');
   const file=form.get('file');if(!(file instanceof File))throw new AccessError(400,'Selecione um arquivo.');
   return respond(await sendWhatsAppMedia(actor,id,{client_request_id:form.get('client_request_id'),caption:form.get('caption')??''},file));
  }
  if(request.method==='POST'&&id&&action==='template')return respond(await sendWhatsAppTemplate(actor,id,await readMutation(request)));
  if(request.method==='PUT'&&id&&action==='link')return respond(await linkWhatsAppConversation(actor,id,await readMutation(request)));
  if(request.method==='PUT'&&id&&action==='automation')return respond(await updateConversationAutomation(actor,id,automationConversationInput.parse(await readMutation(request))));
  throw new AccessError(404,'Recurso não encontrado.');
 }catch(error){
  if(error instanceof WhatsAppLeadDuplicateError)return NextResponse.json({error:error.message,matches:error.matches,multiple:error.multiple},{status:409,headers:{'Cache-Control':'no-store'}});
  return failure(error);
 }
}
export const GET=handle;export const POST=handle;export const PUT=handle;
