import {NextResponse} from 'next/server';
import {apiActor} from '@/server/session';
import {failure,readMutation} from '@/server/http';
import {aiAssistantSettings,runCommercialAi,saveAiAssistantSettings} from '@/modules/ai/assistant';
const respond=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'no-store'}});
export async function GET(){try{return respond(await aiAssistantSettings(await apiActor()));}catch(error){return failure(error);}}
export async function POST(request:Request){try{return respond(await runCommercialAi(await apiActor(),await readMutation(request)));}catch(error){return failure(error);}}
export async function PUT(request:Request){try{return respond(await saveAiAssistantSettings(await apiActor(),await readMutation(request)));}catch(error){return failure(error);}}
