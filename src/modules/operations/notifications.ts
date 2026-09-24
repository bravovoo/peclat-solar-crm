import {z} from 'zod';
import type {PoolClient} from 'pg';
import {database,transaction} from '@/server/db';
import {smtpProvider,type OperationalMailProvider} from '@/integrations/mail';
import {AccessError,requirePermission,type Actor} from '@/modules/auth/policy';

type Db=Pick<PoolClient,'query'>;
type Severity='warning'|'critical';
type NotificationKind='opened'|'escalated'|'resolved';
type AlertNotice={id:string;severity:Severity;title:string;detail:string};
type Delivery={id:string;organization_id:string;alert_id:string;notification_kind:NotificationKind;recipient:string;severity:Severity;title:string;detail:string;attempts:number};

const settingsInput=z.object({
 email_enabled:z.boolean(),
 recipients:z.array(z.string().trim().toLowerCase().pipe(z.email('E-mail inválido.'))).max(5,'Informe no máximo cinco destinatários.'),
 minimum_severity:z.enum(['warning','critical']),
 notify_recovery:z.boolean(),
 critical_escalation_minutes:z.number().int().min(15).max(1440),
 version:z.number().int().positive(),
}).strict().transform(value=>({...value,recipients:[...new Set(value.recipients)]})).refine(value=>!value.email_enabled||value.recipients.length>0,{message:'Informe ao menos um destinatário para ativar os alertas.',path:['recipients']});

export async function operationalNotificationSettings(actor:Actor){
 requirePermission(actor,'operations.read');
 const result=await database().query('SELECT email_enabled,recipients,minimum_severity,notify_recovery,critical_escalation_minutes,version,updated_at FROM organization_operational_notification_settings WHERE organization_id=$1',[actor.organizationId]);
 return result.rows[0]??{email_enabled:false,recipients:[],minimum_severity:'critical',notify_recovery:true,critical_escalation_minutes:60,version:1,updated_at:null};
}

export async function saveOperationalNotificationSettings(actor:Actor,input:unknown){
 requirePermission(actor,'operations.manage');
 if(actor.role!=='admin')throw new AccessError(403,'Somente administradores podem configurar alertas externos.');
 const data=settingsInput.parse(input);
 if(data.email_enabled&&!process.env.SMTP_HOST)throw new AccessError(409,'Configure o SMTP no ambiente antes de ativar alertas por e-mail.');
 return transaction(async db=>{
  const current=await db.query<{version:number}>('SELECT version FROM organization_operational_notification_settings WHERE organization_id=$1 FOR UPDATE',[actor.organizationId]);
  if(current.rowCount&&Number(current.rows[0].version)!==data.version)throw new AccessError(409,'As configurações foram atualizadas. Recarregue a página.');
  if(!current.rowCount&&data.version!==1)throw new AccessError(409,'As configurações foram atualizadas. Recarregue a página.');
  await db.query(`INSERT INTO organization_operational_notification_settings(organization_id,email_enabled,recipients,minimum_severity,notify_recovery,critical_escalation_minutes,updated_by)
   VALUES ($1,$2,$3,$4,$5,$6,$7)
   ON CONFLICT(organization_id) DO UPDATE SET email_enabled=excluded.email_enabled,recipients=excluded.recipients,minimum_severity=excluded.minimum_severity,notify_recovery=excluded.notify_recovery,critical_escalation_minutes=excluded.critical_escalation_minutes,updated_by=excluded.updated_by,version=organization_operational_notification_settings.version+1,updated_at=now()`,[actor.organizationId,data.email_enabled,data.recipients,data.minimum_severity,data.notify_recovery,data.critical_escalation_minutes,actor.userId]);
  await db.query('INSERT INTO audit_logs(organization_id,actor_id,action,detail) VALUES ($1,$2,$3,$4)',[actor.organizationId,actor.userId,'operations.notifications.updated',`Alertas externos: ${data.email_enabled?'ativos':'pausados'}; destinatários: ${data.recipients.length}; severidade mínima: ${data.minimum_severity}.`]);
  return (await db.query('SELECT email_enabled,recipients,minimum_severity,notify_recovery,critical_escalation_minutes,version,updated_at FROM organization_operational_notification_settings WHERE organization_id=$1',[actor.organizationId])).rows[0];
 });
}

export async function enqueueAlertNotifications(db:Db,organizationId:string,alert:AlertNotice,kind:NotificationKind){
 const settings=await db.query<{email_enabled:boolean;recipients:string[];minimum_severity:Severity;notify_recovery:boolean}>('SELECT email_enabled,recipients,minimum_severity,notify_recovery FROM organization_operational_notification_settings WHERE organization_id=$1',[organizationId]);
 const value=settings.rows[0];
 if(!value?.email_enabled||!value.recipients.length)return 0;
 if(kind==='resolved'&&!value.notify_recovery)return 0;
 if(kind!=='resolved'&&value.minimum_severity==='critical'&&alert.severity!=='critical')return 0;
 const result=await db.query(`INSERT INTO operational_alert_deliveries(organization_id,alert_id,notification_kind,recipient)
  SELECT $1,$2,$3,recipient FROM unnest($4::text[]) recipient
  ON CONFLICT(organization_id,alert_id,notification_kind,recipient) DO NOTHING`,[organizationId,alert.id,kind,value.recipients]);
 return result.rowCount??0;
}

export async function enqueueOperationalEscalations(db:Db,organizationId:string){
 const alerts=await db.query<AlertNotice>(`SELECT a.id,a.severity,a.title,a.detail FROM operational_alerts a
  JOIN organization_operational_notification_settings s ON s.organization_id=a.organization_id
  WHERE a.organization_id=$1 AND a.status='open' AND a.severity='critical' AND s.email_enabled
   AND a.first_detected_at<=now()-make_interval(mins=>s.critical_escalation_minutes)`,[organizationId]);
 let queued=0;for(const alert of alerts.rows)queued+=await enqueueAlertNotifications(db,organizationId,alert,'escalated');return queued;
}

function content(delivery:Delivery){
 const label=delivery.notification_kind==='resolved'?'RECUPERADO':delivery.notification_kind==='escalated'?'ESCALADO':delivery.severity==='critical'?'CRÍTICO':'ATENÇÃO';
 const subject=`[Peclat CRM] ${label}: ${delivery.title}`.slice(0,180);
 const message=[`Monitoramento operacional Peclat Solar CRM`,`Status: ${label}`,`Ocorrência: ${delivery.title}`,delivery.detail,'',delivery.notification_kind==='resolved'?'A condição deixou de ser detectada.':'Acesse Configurações → Monitoramento operacional para revisar o incidente.'].join('\n');
 return {subject,message};
}

async function claimDelivery(){return transaction(async db=>{
 await db.query("UPDATE operational_alert_deliveries SET status='uncertain',safe_error='delivery_confirmation_timeout',updated_at=now() WHERE status='processing' AND locked_at<now()-interval '15 minutes'");
 const result=await db.query<Delivery>(`SELECT d.id,d.organization_id,d.alert_id,d.notification_kind,d.recipient,d.attempts,a.severity,a.title,a.detail
  FROM operational_alert_deliveries d JOIN operational_alerts a ON a.organization_id=d.organization_id AND a.id=d.alert_id
  WHERE d.status='pending' AND d.scheduled_for<=now() ORDER BY d.scheduled_for,d.created_at FOR UPDATE OF d SKIP LOCKED LIMIT 1`);
 const delivery=result.rows[0];if(!delivery)return null;
 await db.query("UPDATE operational_alert_deliveries SET status='processing',attempts=attempts+1,locked_at=now(),updated_at=now() WHERE id=$1",[delivery.id]);return delivery;
 });}

export async function processOperationalAlertDeliveries(limit=25,mail?:OperationalMailProvider){
 if(!mail&&!process.env.SMTP_HOST)return {processed:0,sent:0,failed:0,configured:false};
 const provider=mail??smtpProvider();let processed=0,sent=0,failed=0;
 while(processed<limit){const delivery=await claimDelivery();if(!delivery)break;processed++;
  try{const body=content(delivery),result=await provider.sendOperationalAlert({to:delivery.recipient,...body});await database().query("UPDATE operational_alert_deliveries SET status='sent',sent_at=now(),provider_message_id=$2,safe_error='',updated_at=now() WHERE id=$1 AND status='processing'",[delivery.id,result.messageId.slice(0,500)]);sent++;}
  catch{await database().query("UPDATE operational_alert_deliveries SET status='failed',safe_error='smtp_delivery_failed',updated_at=now() WHERE id=$1 AND status='processing'",[delivery.id]);failed++;}
 }
 return {processed,sent,failed,configured:true};
}

export async function recentOperationalDeliveries(actor:Actor){requirePermission(actor,'operations.read');return (await database().query(`SELECT d.id,d.alert_id,d.notification_kind,d.status,d.attempts,d.safe_error,d.created_at,d.sent_at,a.title,a.severity
 FROM operational_alert_deliveries d JOIN operational_alerts a ON a.organization_id=d.organization_id AND a.id=d.alert_id
 WHERE d.organization_id=$1 ORDER BY d.created_at DESC,d.id DESC LIMIT 30`,[actor.organizationId])).rows;}
