ALTER TABLE organization_lead_recovery_settings
 ADD COLUMN default_owner_id uuid,
 ADD FOREIGN KEY(organization_id,default_owner_id) REFERENCES memberships(organization_id,user_id);

-- Preserve the administrator who configured recovery as the initial default.
-- When that account is unavailable, only choose automatically if the organization
-- has exactly one active administrator.
WITH active_admins AS (
 SELECT m.organization_id,m.user_id,
        count(*) OVER(PARTITION BY m.organization_id) active_admin_count
 FROM memberships m
 JOIN users u ON u.id=m.user_id
 WHERE m.role_code='admin' AND m.active AND u.active
), defaults AS (
 SELECT settings.organization_id,
        COALESCE(configured.user_id,single_admin.user_id) user_id
 FROM organization_lead_recovery_settings settings
 LEFT JOIN active_admins configured
   ON configured.organization_id=settings.organization_id
  AND configured.user_id=settings.updated_by
 LEFT JOIN active_admins single_admin
   ON single_admin.organization_id=settings.organization_id
  AND single_admin.active_admin_count=1
)
UPDATE organization_lead_recovery_settings settings
SET default_owner_id=defaults.user_id
FROM defaults
WHERE settings.organization_id=defaults.organization_id
  AND defaults.user_id IS NOT NULL
  AND settings.default_owner_id IS NULL;

-- Backfill only active WhatsApp leads that have never received an owner.
WITH candidates AS MATERIALIZED (
 SELECT record.organization_id,record.id,settings.default_owner_id owner_id
 FROM crm_records record
 JOIN organization_lead_recovery_settings settings
   ON settings.organization_id=record.organization_id
 JOIN memberships membership
   ON membership.organization_id=settings.organization_id
  AND membership.user_id=settings.default_owner_id
  AND membership.role_code='admin'
  AND membership.active
 JOIN users owner ON owner.id=membership.user_id AND owner.active
 WHERE record.kind='lead'
   AND record.status='active'
   AND record.deleted_at IS NULL
   AND record.owner_id IS NULL
   AND record.source IN ('WhatsApp','WhatsApp Flow')
), updated AS (
 UPDATE crm_records record
 SET owner_id=candidates.owner_id,version=version+1,updated_at=now()
 FROM candidates
 WHERE record.organization_id=candidates.organization_id
   AND record.id=candidates.id
   AND record.owner_id IS NULL
 RETURNING record.organization_id,record.id,record.owner_id
), activities AS (
 INSERT INTO crm_activities(organization_id,record_id,actor_id,action,detail)
 SELECT organization_id,id,owner_id,'whatsapp.owner_assigned',
        'Responsável padrão atribuído automaticamente ao Lead originado pelo WhatsApp.'
 FROM updated
 RETURNING organization_id,record_id
)
INSERT INTO audit_logs(organization_id,actor_id,action,detail)
SELECT organization_id,owner_id,'whatsapp.owner_assigned',
       'Responsável padrão atribuído automaticamente; origem=WhatsApp; lead_id='||id::text||'.'
FROM updated;

CREATE INDEX whatsapp_messages_recovery_inbound_latest_idx
 ON whatsapp_messages(organization_id,conversation_id,(COALESCE(meta_timestamp,created_at)) DESC,id DESC)
 WHERE direction='inbound';

CREATE INDEX whatsapp_messages_recovery_outbound_latest_idx
 ON whatsapp_messages(organization_id,conversation_id,(COALESCE(meta_timestamp,created_at)) DESC,created_at DESC,id DESC)
 WHERE direction='outbound'
   AND origin<>'lead_recovery'
   AND COALESCE(safe_metadata->>'system_purpose','')<>'consent_request'
   AND delivery_status IN ('sent','delivered','read')
   AND NOT outcome_uncertain;
