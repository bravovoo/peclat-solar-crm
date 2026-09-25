CREATE TABLE ai_knowledge_guidance (
 organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
 tone text NOT NULL DEFAULT 'profissional' CHECK(tone IN ('profissional','acolhedor','direto')),
 formality text NOT NULL DEFAULT 'equilibrada' CHECK(formality IN ('formal','equilibrada','informal')),
 response_length text NOT NULL DEFAULT 'curta' CHECK(response_length IN ('curta','media','detalhada')),
 emoji_policy text NOT NULL DEFAULT 'moderado' CHECK(emoji_policy IN ('nenhum','moderado')),
 seller_introduction text NOT NULL DEFAULT '' CHECK(length(seller_introduction)<=300),
 commercial_rules text NOT NULL DEFAULT '' CHECK(length(commercial_rules)<=3000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 updated_by uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,updated_by) REFERENCES memberships(organization_id,user_id)
);

CREATE TABLE ai_knowledge_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 category text NOT NULL CHECK(length(category) BETWEEN 1 AND 80),
 question text NOT NULL CHECK(length(question) BETWEEN 5 AND 500),
 answer text NOT NULL CHECK(length(answer) BETWEEN 1 AND 3000),
 keywords text[] NOT NULL DEFAULT '{}',
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','inactive','rejected','deleted')),
 proposed_by uuid NOT NULL,
 reviewed_by uuid,
 reviewed_at timestamptz,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,proposed_by) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,reviewed_by) REFERENCES memberships(organization_id,user_id)
);
CREATE INDEX ai_knowledge_entries_search_idx ON ai_knowledge_entries USING gin
 (to_tsvector('portuguese',question||' '||category)) WHERE status='active';
CREATE INDEX ai_knowledge_entries_keywords_idx ON ai_knowledge_entries USING gin(keywords) WHERE status='active';
CREATE INDEX ai_knowledge_entries_org_status_idx ON ai_knowledge_entries(organization_id,status,updated_at DESC);

INSERT INTO permissions(code,description) VALUES
 ('ai_knowledge.read','Consultar a base de conhecimento da IA'),
 ('ai_knowledge.propose','Propor resposta para a base de conhecimento da IA'),
 ('ai_knowledge.manage','Aprovar e administrar a base de conhecimento da IA')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_code,permission_code)
 SELECT roles.code,permissions.code FROM roles CROSS JOIN permissions
 WHERE (roles.code='admin' AND permissions.code IN ('ai_knowledge.read','ai_knowledge.propose','ai_knowledge.manage'))
 OR (roles.code IN ('manager','seller') AND permissions.code='ai_knowledge.propose')
ON CONFLICT DO NOTHING;

ALTER TABLE ai_knowledge_guidance ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_knowledge_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE ai_knowledge_guidance,ai_knowledge_entries FROM PUBLIC;
DO $$ DECLARE api_role text; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE ai_knowledge_guidance,ai_knowledge_entries FROM %I',api_role);
  END IF;
 END LOOP;
END $$;
