import {NextResponse} from 'next/server';
import {apiActor} from '@/server/session';
import {failure,readMutation} from '@/server/http';
import {saveWhatsAppConfiguration,whatsappAdminConfiguration} from '@/modules/whatsapp/repository';
export async function GET(){try{return NextResponse.json(await whatsappAdminConfiguration(await apiActor()),{headers:{'Cache-Control':'no-store'}});}catch(error){return failure(error);}}
export async function PUT(request:Request){try{return NextResponse.json(await saveWhatsAppConfiguration(await apiActor(),await readMutation(request)),{headers:{'Cache-Control':'no-store'}});}catch(error){return failure(error);}}
