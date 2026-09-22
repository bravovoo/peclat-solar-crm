CREATE TABLE ai_assistant_settings (
 organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false,
 provider text NOT NULL DEFAULT 'openai' CHECK(provider IN ('openai')),
 model text NOT NULL DEFAULT 'gpt-5-mini' CHECK(length(model) BETWEEN 1 AND 100),
 context_message_limit integer NOT NULL DEFAULT 40 CHECK(context_message_limit BETWEEN 10 AND 50),
 max_requests_per_hour integer NOT NULL DEFAULT 60 CHECK(max_requests_per_hour BETWEEN 1 AND 500),
 updated_by uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,updated_by) REFERENCES memberships(organization_id,user_id)
);

CREATE TABLE ai_usage_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 user_id uuid NOT NULL,
 conversation_id uuid NOT NULL,
 request_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('summarize','suggest_reply','next_action','missing_information','follow_up','closing_support')),
 provider text NOT NULL CHECK(length(provider) BETWEEN 1 AND 50),
 model text NOT NULL CHECK(length(model) BETWEEN 1 AND 100),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','succeeded','failed')),
 duration_ms integer CHECK(duration_ms>=0),
 input_tokens integer CHECK(input_tokens>=0),
 output_tokens integer CHECK(output_tokens>=0),
 error_code text NOT NULL DEFAULT '' CHECK(length(error_code)<=80),
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 UNIQUE(organization_id,user_id,request_id),
 FOREIGN KEY(organization_id,user_id) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,conversation_id) REFERENCES whatsapp_conversations(organization_id,id)
);
CREATE INDEX ai_usage_events_rate_idx ON ai_usage_events(organization_id,user_id,created_at DESC);
CREATE INDEX ai_usage_events_org_idx ON ai_usage_events(organization_id,created_at DESC);

INSERT INTO permissions(code,description) VALUES
 ('ai_assistant.use','Usar o assistente comercial com IA'),
 ('ai_assistant.manage','Configurar o assistente comercial com IA')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_code,permission_code)
SELECT r.code,p.code FROM roles r CROSS JOIN permissions p WHERE
 (r.code='admin' AND p.code IN ('ai_assistant.use','ai_assistant.manage')) OR
 (r.code IN ('manager','seller') AND p.code='ai_assistant.use')
ON CONFLICT DO NOTHING;

ALTER TABLE ai_assistant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE ai_assistant_settings,ai_usage_events FROM PUBLIC;
DO $$ DECLARE api_role text; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE ai_assistant_settings,ai_usage_events FROM %I',api_role);
  END IF;
 END LOOP;
END $$;
