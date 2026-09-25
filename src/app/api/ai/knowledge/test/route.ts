import {NextResponse} from 'next/server';
import {apiActor} from '@/server/session';
import {failure,readMutation} from '@/server/http';
import {testAiKnowledge} from '@/modules/ai/assistant';
export async function POST(request:Request){try{return NextResponse.json(await testAiKnowledge(await apiActor(),await readMutation(request)),{headers:{'Cache-Control':'no-store'}});}catch(error){return failure(error);}}
