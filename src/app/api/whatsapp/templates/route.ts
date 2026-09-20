import {NextResponse} from 'next/server';
import {apiActor} from '@/server/session';
import {failure,readMutation} from '@/server/http';
import {listWhatsAppTemplates,syncWhatsAppTemplates} from '@/modules/whatsapp/outbound';
export async function GET(){try{return NextResponse.json(await listWhatsAppTemplates(await apiActor()),{headers:{'Cache-Control':'no-store'}});}catch(error){return failure(error);}}
export async function POST(request:Request){try{await readMutation(request);return NextResponse.json(await syncWhatsAppTemplates(await apiActor()),{headers:{'Cache-Control':'no-store'}});}catch(error){return failure(error);}}
