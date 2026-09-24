import {NextResponse} from 'next/server';
import {z} from 'zod';
import {apiActor} from '@/server/session';
import {failure,readMutation} from '@/server/http';
import {AccessError} from '@/modules/auth/policy';
import {createTemplateDraft,submitTemplateDraft,synchronizeTemplateManager,templateManagerOverview,updateTemplateDraft} from '@/modules/whatsapp/template-manager';

type Context={params:Promise<{segments?:string[]}>};
const respond=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'no-store'}});
async function handle(request:Request,context:Context){try{const actor=await apiActor(),segments=(await context.params).segments??[],[first,second]=segments;if(segments.length>2)throw new AccessError(404,'Recurso não encontrado.');if(request.method==='GET'&&!first)return respond(await templateManagerOverview(actor));if(request.method==='POST'&&!first)return respond(await createTemplateDraft(actor,await readMutation(request)),201);if(request.method==='POST'&&first==='sync'&&!second){await readMutation(request);return respond(await synchronizeTemplateManager(actor));}const id=z.uuid().parse(first);if(request.method==='PUT'&&!second)return respond(await updateTemplateDraft(actor,id,await readMutation(request)));if(request.method==='POST'&&second==='submit')return respond(await submitTemplateDraft(actor,id,await readMutation(request)));throw new AccessError(404,'Recurso não encontrado.');}catch(error){return failure(error);}}
export const GET=handle;export const POST=handle;export const PUT=handle;
