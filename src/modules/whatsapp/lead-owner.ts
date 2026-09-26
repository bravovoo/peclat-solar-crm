import type {PoolClient} from 'pg';

type Db=Pick<PoolClient,'query'>;

export async function defaultWhatsAppLeadOwner(db:Db,organizationId:string){
 const result=await db.query<{user_id:string}>(`WITH active_admins AS (
   SELECT membership.user_id,count(*) OVER() active_admin_count
   FROM memberships membership
   JOIN users owner ON owner.id=membership.user_id
   WHERE membership.organization_id=$1 AND membership.role_code='admin' AND membership.active AND owner.active
  ), configured AS (
   SELECT settings.default_owner_id user_id
   FROM organization_lead_recovery_settings settings
   JOIN active_admins admin ON admin.user_id=settings.default_owner_id
   WHERE settings.organization_id=$1
  )
  SELECT user_id FROM configured
  UNION ALL
  SELECT user_id FROM active_admins
  WHERE active_admin_count=1 AND NOT EXISTS(SELECT 1 FROM configured)
  LIMIT 1`,[organizationId]);
 return result.rows[0]?.user_id??null;
}

export async function assignUnownedWhatsAppLeads(db:Db,organizationId:string){
 const result=await db.query<{assigned:number;unresolved:number}>(`WITH active_admins AS (
   SELECT membership.user_id,count(*) OVER() active_admin_count
   FROM memberships membership
   JOIN users owner ON owner.id=membership.user_id
   WHERE membership.organization_id=$1 AND membership.role_code='admin' AND membership.active AND owner.active
  ), configured AS (
   SELECT settings.default_owner_id owner_id
   FROM organization_lead_recovery_settings settings
   JOIN active_admins admin ON admin.user_id=settings.default_owner_id
   WHERE settings.organization_id=$1
  ), resolved AS (
   SELECT owner_id FROM configured
   UNION ALL
   SELECT user_id FROM active_admins WHERE active_admin_count=1 AND NOT EXISTS(SELECT 1 FROM configured)
   LIMIT 1
  ), candidates AS MATERIALIZED (
   SELECT record.id,resolved.owner_id
   FROM crm_records record CROSS JOIN resolved
   WHERE record.organization_id=$1 AND record.kind='lead' AND record.status='active' AND record.deleted_at IS NULL
     AND record.owner_id IS NULL AND record.source IN ('WhatsApp','WhatsApp Flow')
  ), updated AS (
   UPDATE crm_records record SET owner_id=candidates.owner_id,version=version+1,updated_at=now()
   FROM candidates WHERE record.organization_id=$1 AND record.id=candidates.id AND record.owner_id IS NULL
   RETURNING record.id,record.owner_id
  ), activities AS (
   INSERT INTO crm_activities(organization_id,record_id,actor_id,action,detail)
   SELECT $1,id,owner_id,'whatsapp.owner_assigned','Responsável padrão atribuído automaticamente ao Lead originado pelo WhatsApp.' FROM updated
  ), audits AS (
   INSERT INTO audit_logs(organization_id,actor_id,action,detail)
   SELECT $1,owner_id,'whatsapp.owner_assigned','Responsável padrão atribuído automaticamente; origem=WhatsApp; lead_id='||id::text||'.' FROM updated
  )
  SELECT (SELECT count(*)::int FROM updated) assigned,
         (SELECT count(*)::int FROM crm_records record WHERE record.organization_id=$1 AND record.kind='lead' AND record.status='active' AND record.deleted_at IS NULL AND record.owner_id IS NULL AND record.source IN ('WhatsApp','WhatsApp Flow')) unresolved`,[organizationId]);
 return result.rows[0]??{assigned:0,unresolved:0};
}
