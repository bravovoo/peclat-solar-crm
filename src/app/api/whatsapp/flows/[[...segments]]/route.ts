import {NextResponse} from 'next/server';
import {z} from 'zod';
import {apiActor} from '@/server/session';
import {failure,readMutation} from '@/server/http';
import {AccessError} from '@/modules/auth/policy';
import {createFlowDraft,createFlowOnMeta,deprecateFlow,flowManagerOverview,flowMappings,publishFlow,saveFlowMappings,synchronizeFlows,updateFlowDraft,validateFlowOnMeta} from '@/modules/whatsapp/flow-manager';
import {listPublishedFlows} from '@/modules/whatsapp/flow-outbound';

type Context={params:Promise<{segments?:string[]}>};
const respond=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'no-store'}});
async function handle(request:Request,context:Context){try{const actor=await apiActor(),segments=(await context.params).segments??[],[first,second]=segments;if(segments.length>2)throw new AccessError(404,'Recurso não encontrado.');if(request.method==='GET'&&!first)return respond(await flowManagerOverview(actor));if(request.method==='GET'&&first==='available'&&!second)return respond(await listPublishedFlows(actor));if(request.method==='POST'&&!first)return respond(await createFlowDraft(actor,await readMutation(request)),201);if(request.method==='POST'&&first==='sync'&&!second){await readMutation(request);return respond(await synchronizeFlows(actor));}const id=z.uuid().parse(first);if(request.method==='PUT'&&!second)return respond(await updateFlowDraft(actor,id,await readMutation(request)));if(request.method==='GET'&&second==='mappings')return respond(await flowMappings(actor,id));if(request.method==='PUT'&&second==='mappings')return respond(await saveFlowMappings(actor,id,await readMutation(request)));if(request.method==='POST'&&second==='create-meta')return respond(await createFlowOnMeta(actor,id,await readMutation(request)));if(request.method==='POST'&&second==='validate')return respond(await validateFlowOnMeta(actor,id,await readMutation(request)));if(request.method==='POST'&&second==='publish')return respond(await publishFlow(actor,id,await readMutation(request)));if(request.method==='POST'&&second==='deprecate')return respond(await deprecateFlow(actor,id,await readMutation(request)));throw new AccessError(404,'Recurso não encontrado.');}catch(error){return failure(error);}}
export const GET=handle;export const POST=handle;export const PUT=handle;
