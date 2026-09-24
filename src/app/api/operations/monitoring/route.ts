import {NextResponse} from 'next/server';
import {z} from 'zod';
import {apiActor} from '@/server/session';
import {failure,readMutation} from '@/server/http';
import {acknowledgeOperationalAlert,operationalSummary} from '@/modules/operations/monitoring';
const respond=(value:unknown)=>NextResponse.json(value,{headers:{'Cache-Control':'no-store'}});
export async function GET(){try{return respond(await operationalSummary(await apiActor()));}catch(error){return failure(error);}}
export async function POST(request:Request){try{const body=z.object({alert_id:z.string().uuid()}).strict().parse(await readMutation(request));return respond(await acknowledgeOperationalAlert(await apiActor(),body.alert_id));}catch(error){return failure(error);}}
