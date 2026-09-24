import {NextResponse} from 'next/server';
import {apiActor} from '@/server/session';
import {failure,readMutation} from '@/server/http';
import {listUserNotifications,markUserNotificationRead} from '@/modules/lead-recovery/repository';
import {notificationReadInput} from '@/modules/lead-recovery/domain';
export async function GET(){try{return NextResponse.json(await listUserNotifications(await apiActor()),{headers:{'Cache-Control':'no-store'}});}catch(error){return failure(error);}}
export async function POST(request:Request){try{const actor=await apiActor(),data=notificationReadInput.parse(await readMutation(request));return NextResponse.json(await markUserNotificationRead(actor,data.notification_id),{headers:{'Cache-Control':'no-store'}});}catch(error){return failure(error);}}
