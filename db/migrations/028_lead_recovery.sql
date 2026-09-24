INSERT INTO permissions(code,description) VALUES
 ('lead_recovery.read','Visualizar recuperação automática de leads'),
 ('lead_recovery.manage','Configurar recuperação automática de leads'),
 ('lead_recovery.operate','Operar recuperação automática de leads')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_code,permission_code)
SELECT roles.code,permissions.code FROM roles CROSS JOIN permissions
WHERE (roles.code='admin' AND permissions.code IN ('lead_recovery.read','lead_recovery.manage','lead_recovery.operate'))
   OR (roles.code IN ('manager','seller') AND permissions.code IN ('lead_recovery.read','lead_recovery.operate'))
ON CONFLICT DO NOTHING;

CREATE TABLE organization_lead_recovery_settings (
 organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false,
 include_uncontacted boolean NOT NULL DEFAULT false,
 timezone text NOT NULL DEFAULT 'America/Sao_Paulo' CHECK(length(timezone) BETWEEN 3 AND 80),
 business_hours jsonb NOT NULL DEFAULT '{"1":{"enabled":true,"start":"08:00","end":"18:00"},"2":{"enabled":true,"start":"08:00","end":"18:00"},"3":{"enabled":true,"start":"08:00","end":"18:00"},"4":{"enabled":true,"start":"08:00","end":"18:00"},"5":{"enabled":true,"start":"08:00","end":"18:00"},"6":{"enabled":true,"start":"08:00","end":"12:00"},"7":{"enabled":false,"start":"08:00","end":"18:00"}}'::jsonb
  CHECK(jsonb_typeof(business_hours)='object' AND octet_length(business_hours::text)<=4096),
 lead_stages text[] NOT NULL DEFAULT ARRAY['new','contact','qualified','awaiting_bill','bill_received','analysis','sizing','budget','proposal','negotiation']::text[]
  CHECK(cardinality(lead_stages) BETWEEN 1 AND 18),
 seller_ids uuid[] NOT NULL DEFAULT '{}'::uuid[] CHECK(cardinality(seller_ids)<=200),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 updated_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,updated_by) REFERENCES memberships(organization_id,user_id)
);

CREATE TABLE lead_recovery_steps (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 position integer NOT NULL CHECK(position BETWEEN 1 AND 5),
 delay_days integer NOT NULL CHECK(delay_days BETWEEN 1 AND 365),
 template_id uuid NOT NULL,
 header_parameters jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(header_parameters)='array' AND octet_length(header_parameters::text)<=4096),
 body_parameters jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(body_parameters)='array' AND octet_length(body_parameters::text)<=8192),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,position),
 FOREIGN KEY(organization_id,template_id) REFERENCES whatsapp_templates(organization_id,id)
);

CREATE TABLE crm_contact_preferences (
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 record_id uuid NOT NULL,
 whatsapp_consent_status text NOT NULL DEFAULT 'unknown' CHECK(whatsapp_consent_status IN ('unknown','opted_in','opted_out')),
 consent_source text NOT NULL DEFAULT '' CHECK(length(consent_source)<=180),
 consented_at timestamptz,
 opted_out_at timestamptz,
 updated_by uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,record_id),
 FOREIGN KEY(organization_id,record_id) REFERENCES crm_records(organization_id,id) ON DELETE CASCADE,
 FOREIGN KEY(organization_id,updated_by) REFERENCES memberships(organization_id,user_id),
 CHECK((whatsapp_consent_status='opted_in' AND consented_at IS NOT NULL AND opted_out_at IS NULL)
    OR (whatsapp_consent_status='opted_out' AND opted_out_at IS NOT NULL)
    OR (whatsapp_consent_status='unknown' AND consented_at IS NULL AND opted_out_at IS NULL))
);

CREATE TABLE lead_recovery_enrollments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 record_id uuid NOT NULL,
 conversation_id uuid,
 owner_id uuid NOT NULL,
 classification text NOT NULL CHECK(classification IN ('not_contacted','awaiting_reply')),
 status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','paused','responded','completed','cancelled','error')),
 inactivity_anchor timestamptz NOT NULL,
 next_attempt_at timestamptz,
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 5),
 last_attempt_at timestamptz,
 response_at timestamptz,
 state_reason text NOT NULL DEFAULT '' CHECK(length(state_reason)<=180),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by uuid NOT NULL,
 updated_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,record_id) REFERENCES crm_records(organization_id,id),
 FOREIGN KEY(organization_id,conversation_id) REFERENCES whatsapp_conversations(organization_id,id),
 FOREIGN KEY(organization_id,owner_id) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,created_by) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,updated_by) REFERENCES memberships(organization_id,user_id)
);
CREATE UNIQUE INDEX lead_recovery_enrollments_active_uidx
 ON lead_recovery_enrollments(organization_id,record_id)
 WHERE status IN ('scheduled','paused');
CREATE INDEX lead_recovery_enrollments_due_idx
 ON lead_recovery_enrollments(status,next_attempt_at,id) WHERE status='scheduled';
CREATE INDEX lead_recovery_enrollments_owner_idx
 ON lead_recovery_enrollments(organization_id,owner_id,status,next_attempt_at);

CREATE TABLE lead_recovery_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 enrollment_id uuid NOT NULL,
 step_position integer NOT NULL CHECK(step_position BETWEEN 1 AND 5),
 template_id uuid NOT NULL,
 scheduled_for timestamptz NOT NULL,
 client_request_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','sent','failed','cancelled','uncertain','skipped')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 locked_at timestamptz,
 message_id uuid,
 safe_error text NOT NULL DEFAULT '' CHECK(length(safe_error)<=180),
 sent_at timestamptz,
 completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,enrollment_id,step_position),
 UNIQUE(organization_id,client_request_id),
 FOREIGN KEY(organization_id,enrollment_id) REFERENCES lead_recovery_enrollments(organization_id,id) ON DELETE CASCADE,
 FOREIGN KEY(organization_id,template_id) REFERENCES whatsapp_templates(organization_id,id),
 FOREIGN KEY(organization_id,message_id) REFERENCES whatsapp_messages(organization_id,id)
);
CREATE INDEX lead_recovery_attempts_due_idx
 ON lead_recovery_attempts(status,scheduled_for,id) WHERE status='pending';

CREATE TABLE user_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 user_id uuid NOT NULL,
 notification_type text NOT NULL CHECK(length(notification_type) BETWEEN 2 AND 80),
 title text NOT NULL CHECK(length(title) BETWEEN 2 AND 180),
 detail text NOT NULL DEFAULT '' CHECK(length(detail)<=500),
 entity_type text NOT NULL DEFAULT '' CHECK(length(entity_type)<=40),
 entity_id uuid,
 read_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,user_id) REFERENCES memberships(organization_id,user_id)
);
CREATE INDEX user_notifications_unread_idx ON user_notifications(organization_id,user_id,created_at DESC) WHERE read_at IS NULL;

ALTER TABLE whatsapp_messages ADD COLUMN lead_recovery_attempt_id uuid;

DO $$ DECLARE constraint_name text; BEGIN
 FOR constraint_name IN
  SELECT conname FROM pg_constraint
  WHERE conrelid='whatsapp_messages'::regclass AND contype='c'
    AND (pg_get_constraintdef(oid) ILIKE '%origin%' OR pg_get_constraintdef(oid) ILIKE '%automation_run_id%')
 LOOP
  EXECUTE format('ALTER TABLE whatsapp_messages DROP CONSTRAINT %I',constraint_name);
 END LOOP;
END $$;

ALTER TABLE whatsapp_messages
 ADD CONSTRAINT whatsapp_messages_origin_values_check CHECK(origin IN ('manual','automation','lead_recovery')),
 ADD CONSTRAINT whatsapp_messages_origin_context_check CHECK(
  (origin='manual' AND automation_run_id IS NULL AND automation_action_index IS NULL AND lead_recovery_attempt_id IS NULL) OR
  (origin='automation' AND automation_run_id IS NOT NULL AND automation_action_index BETWEEN 0 AND 9 AND lead_recovery_attempt_id IS NULL) OR
  (origin='lead_recovery' AND automation_run_id IS NULL AND automation_action_index IS NULL AND lead_recovery_attempt_id IS NOT NULL)
 ),
 ADD FOREIGN KEY(organization_id,lead_recovery_attempt_id) REFERENCES lead_recovery_attempts(organization_id,id);
CREATE UNIQUE INDEX whatsapp_messages_lead_recovery_attempt_uidx
 ON whatsapp_messages(organization_id,lead_recovery_attempt_id)
 WHERE lead_recovery_attempt_id IS NOT NULL;

ALTER TABLE organization_lead_recovery_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_recovery_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_contact_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_recovery_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_recovery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE organization_lead_recovery_settings,lead_recovery_steps,crm_contact_preferences,lead_recovery_enrollments,lead_recovery_attempts,user_notifications FROM PUBLIC;
DO $$ DECLARE api_role text; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE organization_lead_recovery_settings,lead_recovery_steps,crm_contact_preferences,lead_recovery_enrollments,lead_recovery_attempts,user_notifications FROM %I',api_role);
  END IF;
 END LOOP;
END $$;
