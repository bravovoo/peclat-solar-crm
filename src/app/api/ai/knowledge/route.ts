import {NextResponse} from 'next/server';
import {apiActor} from '@/server/session';
import {failure,readMutation} from '@/server/http';
import {knowledgeOverview,proposeKnowledge,saveKnowledgeGuidance} from '@/modules/ai/knowledge';
const respond=(value:unknown)=>NextResponse.json(value,{headers:{'Cache-Control':'no-store'}});
export async function GET(){try{return respond(await knowledgeOverview(await apiActor()));}catch(error){return failure(error);}}
export async function POST(request:Request){try{return respond(await proposeKnowledge(await apiActor(),await readMutation(request)));}catch(error){return failure(error);}}
export async function PUT(request:Request){try{return respond(await saveKnowledgeGuidance(await apiActor(),await readMutation(request)));}catch(error){return failure(error);}}
