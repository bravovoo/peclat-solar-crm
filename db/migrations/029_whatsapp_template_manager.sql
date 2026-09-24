INSERT INTO permissions(code,description) VALUES
 ('whatsapp.templates.manage','Criar e submeter modelos oficiais do WhatsApp')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_code,permission_code)
SELECT roles.code,permissions.code FROM roles CROSS JOIN permissions
WHERE roles.code='admin' AND permissions.code='whatsapp.templates.manage'
ON CONFLICT DO NOTHING;

CREATE TABLE whatsapp_template_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(name ~ '^[a-z0-9_]{3,128}$'),
 category text NOT NULL CHECK(category IN ('MARKETING','UTILITY')),
 language text NOT NULL CHECK(language ~ '^[a-z]{2}(?:_[A-Z]{2})?$' AND length(language)<=10),
 body_text text NOT NULL CHECK(length(body_text) BETWEEN 1 AND 1024),
 example_values jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK(jsonb_typeof(example_values)='array' AND jsonb_array_length(example_values)<=10 AND octet_length(example_values::text)<=2048),
 components jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK(jsonb_typeof(components)='array' AND octet_length(components::text)<=32768),
 submission_status text NOT NULL DEFAULT 'DRAFT'
  CHECK(submission_status IN ('DRAFT','SUBMITTING','PENDING','APPROVED','REJECTED','PAUSED','DISABLED','IN_APPEAL','PENDING_DELETION','DELETED','LIMIT_EXCEEDED','UNKNOWN','UNCERTAIN')),
 meta_template_id text CHECK(meta_template_id IS NULL OR length(meta_template_id) BETWEEN 1 AND 180),
 rejection_reason text NOT NULL DEFAULT '' CHECK(length(rejection_reason)<=500),
 safe_error text NOT NULL DEFAULT '' CHECK(length(safe_error)<=500),
 outcome_uncertain boolean NOT NULL DEFAULT false,
 submitted_at timestamptz,
 synced_at timestamptz,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by uuid NOT NULL,
 updated_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,name,language),
 UNIQUE(organization_id,meta_template_id),
 FOREIGN KEY(organization_id,created_by) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,updated_by) REFERENCES memberships(organization_id,user_id)
);

CREATE INDEX whatsapp_template_drafts_status_idx
 ON whatsapp_template_drafts(organization_id,submission_status,updated_at DESC);

ALTER TABLE whatsapp_template_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE whatsapp_template_drafts FROM PUBLIC;
DO $$ DECLARE api_role text; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE whatsapp_template_drafts FROM %I',api_role);
  END IF;
 END LOOP;
END $$;

WITH peclat AS (
 SELECT o.id organization_id,m.user_id
 FROM organizations o
JOIN whatsapp_integrations w ON w.organization_id=o.id
JOIN LATERAL (
 SELECT membership.user_id
 FROM memberships membership
 WHERE membership.organization_id=o.id
   AND membership.role_code='admin'
   AND membership.active
 ORDER BY membership.user_id
 LIMIT 1
) m ON true
 WHERE o.slug='peclat-solar'
), drafts(name,body_text) AS (VALUES
 ('peclat_recuperacao_lead_1',E'Olá, {{1}}! Tudo bem? 😊\n\nAqui é o Rodrigo, da Peclat Solar.\n\nEstou passando para saber se você conseguiu analisar nossa proposta de energia solar e se ficou alguma dúvida.\n\nPodemos conversar sobre seu projeto?'),
 ('peclat_recuperacao_lead_2',E'Olá, {{1}}! Passando para saber se você ainda tem interesse em dar continuidade ao seu projeto de energia solar.\n\nSe precisar ajustar alguma informação da proposta, estou à disposição!'),
 ('peclat_recuperacao_lead_3',E'Olá, {{1}}! Tudo bem?\n\nGostaria de saber se seu projeto de energia solar ainda está nos seus planos.\n\nCaso prefira conversar em outro momento, é só me avisar.')
)
INSERT INTO whatsapp_template_drafts(
 organization_id,name,category,language,body_text,example_values,components,created_by,updated_by
)
SELECT p.organization_id,d.name,'MARKETING','pt_BR',d.body_text,'["Maria"]'::jsonb,
 jsonb_build_array(jsonb_build_object('type','BODY','text',d.body_text,'example',jsonb_build_object('body_text',jsonb_build_array(jsonb_build_array('Maria'))))),
 p.user_id,p.user_id
FROM peclat p CROSS JOIN drafts d
ON CONFLICT(organization_id,name,language) DO NOTHING;
