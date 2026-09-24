import {NextResponse} from 'next/server';
import {z} from 'zod';
import {apiActor} from '@/server/session';
import {failure,readMutation} from '@/server/http';
import {acknowledgeOperationalAlert,operationalSummary} from '@/modules/operations/monitoring';
import {saveOperationalNotificationSettings} from '@/modules/operations/notifications';
const respond=(value:unknown)=>NextResponse.json(value,{headers:{'Cache-Control':'no-store'}});
export async function GET(){try{return respond(await operationalSummary(await apiActor()));}catch(error){return failure(error);}}
export async function POST(request:Request){try{const body=z.union([z.object({alert_id:z.string().uuid()}).strict(),z.object({action:z.literal('save_notifications'),email_enabled:z.boolean(),recipients:z.array(z.string()),minimum_severity:z.enum(['warning','critical']),notify_recovery:z.boolean(),critical_escalation_minutes:z.number(),version:z.number()}).strict()]).parse(await readMutation(request));const actor=await apiActor();if('alert_id' in body)return respond(await acknowledgeOperationalAlert(actor,body.alert_id));return respond(await saveOperationalNotificationSettings(actor,{email_enabled:body.email_enabled,recipients:body.recipients,minimum_severity:body.minimum_severity,notify_recovery:body.notify_recovery,critical_escalation_minutes:body.critical_escalation_minutes,version:body.version}));}catch(error){return failure(error);}}
