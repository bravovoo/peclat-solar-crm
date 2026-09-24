import {z} from 'zod';
import {database,transaction} from '@/server/db';
import {AccessError,requirePermission,type Actor} from '@/modules/auth/policy';
import {enqueueAlertNotifications,enqueueOperationalEscalations,operationalNotificationSettings,recentOperationalDeliveries} from './notifications';

type Severity='warning'|'critical';
type Signal={code:string;severity:Severity;title:string;detail:string};
type AlertNotice={id:string;severity:Severity;title:string;detail:string};
type Snapshot={webhook_failed:number;webhook_overdue:number;storage_failed:number;storage_overdue:number;automation_failed:number;automation_overdue:number;email_failed:number;email_overdue:number;whatsapp_uncertain:number;whatsapp_failed:number;ai_failed:number;ai_total:number};
export type OperationalAlert={id:string;code:string;severity:Severity;status:'open'|'acknowledged'|'resolved';title:string;detail:string;occurrence_count:number;first_detected_at:string;last_detected_at:string;acknowledged_at:string|null;resolved_at:string|null};

const alertId=z.string().uuid();
const number=(value:unknown)=>Number(value??0);

async function snapshot(organizationId:string){
 const result=await database().query<Snapshot>(`SELECT
  (SELECT count(*)::int FROM whatsapp_webhook_batches WHERE organization_id=$1 AND status='failed' AND updated_at>=now()-interval '24 hours') webhook_failed,
  (SELECT count(*)::int FROM whatsapp_webhook_batches WHERE organization_id=$1 AND status IN ('pending','processing') AND COALESCE(locked_at,scheduled_for)<now()-interval '15 minutes') webhook_overdue,
  (SELECT count(*)::int FROM storage_deletion_jobs WHERE organization_id=$1 AND status='failed' AND updated_at>=now()-interval '24 hours') storage_failed,
  (SELECT count(*)::int FROM storage_deletion_jobs WHERE organization_id=$1 AND status IN ('pending','processing') AND COALESCE(locked_at,scheduled_for)<now()-interval '15 minutes') storage_overdue,
  (SELECT count(*)::int FROM automation_jobs WHERE organization_id=$1 AND status='failed' AND COALESCE(failed_at,updated_at)>=now()-interval '24 hours') automation_failed,
  (SELECT count(*)::int FROM automation_jobs WHERE organization_id=$1 AND status IN ('pending','processing') AND COALESCE(locked_at,scheduled_for)<now()-interval '15 minutes') automation_overdue,
  (SELECT count(*)::int FROM crm_document_emails WHERE organization_id=$1 AND status='failed' AND updated_at>=now()-interval '24 hours') email_failed,
  (SELECT count(*)::int FROM crm_document_emails WHERE organization_id=$1 AND status='pending' AND updated_at<now()-interval '15 minutes') email_overdue,
  (SELECT count(*)::int FROM whatsapp_messages WHERE organization_id=$1 AND direction='outbound' AND outcome_uncertain=true AND created_at>=now()-interval '24 hours') whatsapp_uncertain,
  (SELECT count(*)::int FROM whatsapp_messages WHERE organization_id=$1 AND direction='outbound' AND delivery_status='failed' AND failed_at>=now()-interval '1 hour') whatsapp_failed,
  (SELECT count(*)::int FROM ai_usage_events WHERE organization_id=$1 AND status='failed' AND created_at>=now()-interval '1 hour') ai_failed,
  (SELECT count(*)::int FROM ai_usage_events WHERE organization_id=$1 AND created_at>=now()-interval '1 hour') ai_total`,[organizationId]);
 return result.rows[0];
}

function signals(value:Snapshot){
 const found:Signal[]=[];
 const add=(when:boolean,code:string,severity:Severity,title:string,detail:string)=>{if(when)found.push({code,severity,title,detail});};
 add(number(value.webhook_failed)>0||number(value.webhook_overdue)>0,'whatsapp_webhook_queue','critical','Fila de webhooks do WhatsApp requer atenção',`${number(value.webhook_failed)} falha(s) terminal(is) e ${number(value.webhook_overdue)} item(ns) atrasado(s).`);
 add(number(value.storage_failed)>0||number(value.storage_overdue)>0,'storage_deletion_queue','critical','Limpeza do Storage requer atenção',`${number(value.storage_failed)} falha(s) terminal(is) e ${number(value.storage_overdue)} item(ns) atrasado(s).`);
 add(number(value.automation_failed)>0||number(value.automation_overdue)>0,'automation_queue','warning','Automações comerciais com falhas recentes',`${number(value.automation_failed)} falha(s) nas últimas 24 horas e ${number(value.automation_overdue)} job(s) atrasado(s).`);
 add(number(value.email_failed)>0||number(value.email_overdue)>0,'document_email_queue','warning','Envio de documentos por e-mail requer atenção',`${number(value.email_failed)} falha(s) nas últimas 24 horas e ${number(value.email_overdue)} tentativa(s) pendente(s).`);
 add(number(value.whatsapp_uncertain)>0,'whatsapp_outcome_uncertain','critical','Envios de WhatsApp sem confirmação',`${number(value.whatsapp_uncertain)} envio(s) recente(s) têm resultado incerto e não serão repetidos automaticamente.`);
 add(number(value.whatsapp_failed)>=3,'whatsapp_delivery_failures','warning','Falhas de entrega no WhatsApp acima do esperado',`${number(value.whatsapp_failed)} mensagem(ns) falharam na última hora.`);
 add(number(value.ai_failed)>=3&&number(value.ai_failed)*2>=Math.max(1,number(value.ai_total)),'ai_provider_failures','warning','Assistente de IA com falhas recorrentes',`${number(value.ai_failed)} de ${number(value.ai_total)} solicitação(ões) falharam na última hora.`);
 return found;
}

export async function runOperationalMonitoring(){
 const organizations=(await database().query<{id:string}>('SELECT id FROM organizations ORDER BY id')).rows;
 let alerts=0;
 for(const organization of organizations){
  const started=Date.now(),detected=signals(await snapshot(organization.id));alerts+=detected.length;
  await transaction(async db=>{
   const active=(await db.query<{id:string;code:string;status:string;severity:Severity;title:string;detail:string}>("SELECT id,code,status,severity,title,detail FROM operational_alerts WHERE organization_id=$1 AND status IN ('open','acknowledged') FOR UPDATE",[organization.id])).rows;
   const byCode=new Map(active.map(row=>[row.code,row]));
   for(const signal of detected){const existing=byCode.get(signal.code);if(existing){await db.query('UPDATE operational_alerts SET severity=$3,title=$4,detail=$5,occurrence_count=occurrence_count+1,last_detected_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2',[organization.id,existing.id,signal.severity,signal.title,signal.detail]);}else{const alert=(await db.query<AlertNotice>('INSERT INTO operational_alerts(organization_id,code,severity,title,detail) VALUES ($1,$2,$3,$4,$5) RETURNING id,severity,title,detail',[organization.id,signal.code,signal.severity,signal.title,signal.detail])).rows[0];await enqueueAlertNotifications(db,organization.id,alert,'opened');console.warn('operational_alert_opened',{code:signal.code,severity:signal.severity});}}
   const current=new Set(detected.map(signal=>signal.code));
   for(const alert of active)if(!current.has(alert.code)){await db.query("UPDATE operational_alerts SET status='resolved',resolved_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2",[organization.id,alert.id]);await enqueueAlertNotifications(db,organization.id,alert,'resolved');}
   await enqueueOperationalEscalations(db,organization.id);
   const healthy=detected.length===0;
   await db.query(`INSERT INTO operational_monitor_status(organization_id,status,open_alerts,last_checked_at,last_healthy_at,check_duration_ms) VALUES ($1,$2,$3,now(),CASE WHEN $2='healthy' THEN now() END,$4)
    ON CONFLICT(organization_id) DO UPDATE SET status=excluded.status,open_alerts=excluded.open_alerts,last_checked_at=excluded.last_checked_at,last_healthy_at=CASE WHEN excluded.status='healthy' THEN excluded.last_checked_at ELSE operational_monitor_status.last_healthy_at END,check_duration_ms=excluded.check_duration_ms,updated_at=now()`,[organization.id,healthy?'healthy':'degraded',detected.length,Math.max(0,Date.now()-started)]);
  });
 }
 return {organizations:organizations.length,alerts};
}

export async function operationalSummary(actor:Actor){
 requirePermission(actor,'operations.read');
 const [monitor,alerts,queues,whatsapp,ai,notificationSettings,deliveries]=await Promise.all([
  database().query('SELECT status,open_alerts,last_checked_at,last_healthy_at,check_duration_ms FROM operational_monitor_status WHERE organization_id=$1',[actor.organizationId]),
  database().query<OperationalAlert>("SELECT id,code,severity,status,title,detail,occurrence_count,first_detected_at,last_detected_at,acknowledged_at,resolved_at FROM operational_alerts WHERE organization_id=$1 ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END,CASE severity WHEN 'critical' THEN 0 ELSE 1 END,last_detected_at DESC LIMIT 50",[actor.organizationId]),
  snapshot(actor.organizationId),
  database().query<{status:string}>("SELECT status FROM whatsapp_integrations WHERE organization_id=$1",[actor.organizationId]),
  database().query<{enabled:boolean;provider:string}>("SELECT enabled,provider FROM ai_assistant_settings WHERE organization_id=$1",[actor.organizationId]),
  operationalNotificationSettings(actor),
  recentOperationalDeliveries(actor),
 ]);
 const storageProvider=process.env.DOCUMENT_STORAGE_PROVIDER?.trim().toLowerCase();
 const storageConfigured=storageProvider==='supabase'?Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_STORAGE_BUCKET&&(process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY)):storageProvider==='local'&&process.env.NODE_ENV!=='production';
 return {monitor:monitor.rows[0]??null,alerts:alerts.rows,queues:queues,notification_settings:notificationSettings,deliveries,integrations:{database:true,storage:storageConfigured,whatsapp:Boolean(process.env.WHATSAPP_ACCESS_TOKEN&&process.env.WHATSAPP_VERIFY_TOKEN&&process.env.WHATSAPP_APP_SECRET&&whatsapp.rows[0]?.status==='connected'),smtp:Boolean(process.env.SMTP_HOST),ai:Boolean((process.env.GEMINI_API_KEY||process.env.OPENAI_API_KEY)&&ai.rows[0]?.enabled),ai_provider:ai.rows[0]?.provider??null}};
}

export async function acknowledgeOperationalAlert(actor:Actor,id:unknown){
 requirePermission(actor,'operations.manage');const parsed=alertId.parse(id);
 const result=await database().query<OperationalAlert>("UPDATE operational_alerts SET status='acknowledged',acknowledged_by=$3,acknowledged_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2 AND status='open' RETURNING id,code,severity,status,title,detail,occurrence_count,first_detected_at,last_detected_at,acknowledged_at,resolved_at",[actor.organizationId,parsed,actor.userId]);
 if(!result.rowCount)throw new AccessError(404,'Alerta operacional não encontrado ou já reconhecido.');return result.rows[0];
}
