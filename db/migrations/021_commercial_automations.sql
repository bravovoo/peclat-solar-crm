INSERT INTO permissions(code,description) VALUES
 ('automations.read','Visualizar automações comerciais'),
 ('automations.manage','Gerenciar automações comerciais')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_code,permission_code)
SELECT roles.code,permissions.code FROM roles CROSS JOIN permissions
WHERE roles.code IN ('admin','manager')
  AND permissions.code IN ('automations.read','automations.manage')
ON CONFLICT DO NOTHING;

CREATE TABLE organization_automation_settings (
 organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
 whatsapp_outbound_enabled boolean NOT NULL DEFAULT false,
 timezone text NOT NULL DEFAULT 'America/Sao_Paulo' CHECK(length(timezone) BETWEEN 3 AND 80),
 business_hours jsonb NOT NULL DEFAULT '{"1":{"enabled":true,"start":"08:00","end":"18:00"},"2":{"enabled":true,"start":"08:00","end":"18:00"},"3":{"enabled":true,"start":"08:00","end":"18:00"},"4":{"enabled":true,"start":"08:00","end":"18:00"},"5":{"enabled":true,"start":"08:00","end":"18:00"},"6":{"enabled":true,"start":"08:00","end":"12:00"},"7":{"enabled":false,"start":"08:00","end":"18:00"}}'::jsonb
   CHECK(jsonb_typeof(business_hours)='object' AND octet_length(business_hours::text)<=4096),
 max_outbound_per_conversation_24h integer NOT NULL DEFAULT 3 CHECK(max_outbound_per_conversation_24h BETWEEN 1 AND 20),
 max_outbound_per_rule_24h integer NOT NULL DEFAULT 100 CHECK(max_outbound_per_rule_24h BETWEEN 1 AND 1000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 updated_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,updated_by) REFERENCES memberships(organization_id,user_id)
);

CREATE TABLE automation_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(name) BETWEEN 2 AND 180),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=1000),
 active boolean NOT NULL DEFAULT false,
 trigger_type text NOT NULL CHECK(trigger_type IN (
  'whatsapp.inbound_received','whatsapp.conversation_created','whatsapp.conversation_unassigned','whatsapp.lead_created',
  'lead.created','lead.stage_changed','opportunity.stage_changed','task.overdue','no_reply_for_duration','follow_up_due'
 )),
 conditions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(conditions)='object' AND octet_length(conditions::text)<=8192),
 actions jsonb NOT NULL CHECK(jsonb_typeof(actions)='array' AND jsonb_array_length(actions) BETWEEN 1 AND 10 AND octet_length(actions::text)<=16384),
 priority integer NOT NULL DEFAULT 100 CHECK(priority BETWEEN 1 AND 1000),
 cooldown_minutes integer NOT NULL DEFAULT 0 CHECK(cooldown_minutes BETWEEN 0 AND 43200),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by uuid NOT NULL,
 updated_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,name),
 FOREIGN KEY(organization_id,created_by) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,updated_by) REFERENCES memberships(organization_id,user_id)
);
CREATE INDEX automation_rules_active_idx ON automation_rules(organization_id,trigger_type,priority,id) WHERE active;

ALTER TABLE whatsapp_conversations
 ADD COLUMN automation_owner_id uuid,
 ADD COLUMN automations_paused boolean NOT NULL DEFAULT false,
 ADD COLUMN automation_blocked boolean NOT NULL DEFAULT false,
 ADD FOREIGN KEY(organization_id,automation_owner_id) REFERENCES memberships(organization_id,user_id);
CREATE INDEX whatsapp_conversations_automation_owner_idx ON whatsapp_conversations(organization_id,automation_owner_id,status,last_message_at DESC) WHERE automation_owner_id IS NOT NULL;

CREATE TABLE automation_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 rule_id uuid NOT NULL,
 trigger_type text NOT NULL CHECK(length(trigger_type) BETWEEN 2 AND 80),
 trigger_event_id text NOT NULL CHECK(length(trigger_event_id) BETWEEN 1 AND 240),
 entity_type text NOT NULL DEFAULT '' CHECK(length(entity_type)<=40),
 entity_id uuid,
 conversation_id uuid,
 record_id uuid,
 opportunity_id uuid,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','skipped','failed')),
 skipped_reason text NOT NULL DEFAULT '' CHECK(length(skipped_reason)<=100),
 safe_error text NOT NULL DEFAULT '' CHECK(length(safe_error)<=500),
 trigger_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(trigger_payload)='object' AND octet_length(trigger_payload::text)<=8192),
 started_at timestamptz,
 completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,rule_id,trigger_event_id),
 FOREIGN KEY(organization_id,rule_id) REFERENCES automation_rules(organization_id,id),
 FOREIGN KEY(organization_id,conversation_id) REFERENCES whatsapp_conversations(organization_id,id),
 FOREIGN KEY(organization_id,record_id) REFERENCES crm_records(organization_id,id),
 FOREIGN KEY(organization_id,opportunity_id) REFERENCES crm_opportunities(organization_id,id)
);
CREATE INDEX automation_runs_history_idx ON automation_runs(organization_id,created_at DESC,id DESC);
CREATE INDEX automation_runs_rule_idx ON automation_runs(organization_id,rule_id,created_at DESC);

CREATE TABLE automation_run_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 run_id uuid NOT NULL,
 action_index integer NOT NULL CHECK(action_index BETWEEN 0 AND 9),
 action_type text NOT NULL CHECK(length(action_type) BETWEEN 2 AND 80),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','skipped','failed')),
 result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<=8192),
 safe_error text NOT NULL DEFAULT '' CHECK(length(safe_error)<=500),
 started_at timestamptz,
 completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,run_id,action_index),
 FOREIGN KEY(organization_id,run_id) REFERENCES automation_runs(organization_id,id) ON DELETE CASCADE
);
CREATE INDEX automation_run_actions_run_idx ON automation_run_actions(organization_id,run_id,action_index);

CREATE TABLE automation_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 automation_rule_id uuid NOT NULL,
 trigger_event_id text NOT NULL CHECK(length(trigger_event_id) BETWEEN 1 AND 240),
 entity_type text NOT NULL DEFAULT '' CHECK(length(entity_type)<=40),
 entity_id uuid,
 scheduled_for timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed','cancelled')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 10),
 locked_at timestamptz,
 completed_at timestamptz,
 failed_at timestamptz,
 safe_error text NOT NULL DEFAULT '' CHECK(length(safe_error)<=500),
 payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=8192),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,automation_rule_id,trigger_event_id),
 FOREIGN KEY(organization_id,automation_rule_id) REFERENCES automation_rules(organization_id,id) ON DELETE CASCADE
);
CREATE INDEX automation_jobs_due_idx ON automation_jobs(status,scheduled_for,id) WHERE status='pending';
CREATE INDEX automation_jobs_org_idx ON automation_jobs(organization_id,created_at DESC,id DESC);

ALTER TABLE whatsapp_messages
 ADD COLUMN automation_run_id uuid,
 ADD COLUMN automation_action_index integer,
 ADD COLUMN origin text NOT NULL DEFAULT 'manual' CHECK(origin IN ('manual','automation')),
 ADD CHECK((origin='manual' AND automation_run_id IS NULL AND automation_action_index IS NULL) OR
           (origin='automation' AND automation_run_id IS NOT NULL AND automation_action_index BETWEEN 0 AND 9)),
 ADD FOREIGN KEY(organization_id,automation_run_id) REFERENCES automation_runs(organization_id,id);
CREATE UNIQUE INDEX whatsapp_messages_automation_action_uidx
 ON whatsapp_messages(organization_id,automation_run_id,automation_action_index)
 WHERE automation_run_id IS NOT NULL;

ALTER TABLE crm_tasks
 ADD COLUMN origin text NOT NULL DEFAULT 'manual' CHECK(origin IN ('manual','automation')),
 ADD COLUMN automation_run_id uuid,
 ADD COLUMN automation_action_index integer,
 ADD CHECK((origin='manual' AND automation_run_id IS NULL AND automation_action_index IS NULL) OR
           (origin='automation' AND automation_run_id IS NOT NULL AND automation_action_index BETWEEN 0 AND 9)),
 ADD FOREIGN KEY(organization_id,automation_run_id) REFERENCES automation_runs(organization_id,id);
CREATE UNIQUE INDEX crm_tasks_automation_action_uidx
 ON crm_tasks(organization_id,automation_run_id,automation_action_index)
 WHERE automation_run_id IS NOT NULL;

ALTER TABLE organization_automation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_run_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_jobs ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE organization_automation_settings,automation_rules,automation_runs,automation_run_actions,automation_jobs FROM PUBLIC;
DO $$ DECLARE api_role text; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE organization_automation_settings,automation_rules,automation_runs,automation_run_actions,automation_jobs FROM %I',api_role);
  END IF;
 END LOOP;
END $$;
