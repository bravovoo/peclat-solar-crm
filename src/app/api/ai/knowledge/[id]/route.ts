import {NextResponse} from 'next/server';
import {apiActor} from '@/server/session';
import {failure,readMutation} from '@/server/http';
import {changeKnowledgeStatus,editKnowledge} from '@/modules/ai/knowledge';
const respond=(value:unknown)=>NextResponse.json(value,{headers:{'Cache-Control':'no-store'}});
type Params={params:Promise<{id:string}>};
export async function PUT(request:Request,{params}:Params){try{return respond(await editKnowledge(await apiActor(),(await params).id,await readMutation(request)));}catch(error){return failure(error);}}
export async function PATCH(request:Request,{params}:Params){try{return respond(await changeKnowledgeStatus(await apiActor(),(await params).id,await readMutation(request)));}catch(error){return failure(error);}}
