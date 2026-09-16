CREATE TABLE installations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 contract_id uuid NOT NULL, installation_number text NOT NULL CHECK(length(installation_number) BETWEEN 8 AND 50),
 responsible_user_id uuid NOT NULL, team_name text NOT NULL DEFAULT '' CHECK(length(team_name)<=180),
 installation_address text NOT NULL CHECK(length(installation_address) BETWEEN 5 AND 500),
 status text NOT NULL DEFAULT 'awaiting_schedule' CHECK(status IN ('awaiting_schedule','scheduled','awaiting_equipment','in_progress','pending_issue','completed','cancelled')),
 planned_on date, scheduled_on date, started_on date, completed_on date,
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000), created_by uuid NOT NULL, updated_by uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id), UNIQUE(organization_id,contract_id), UNIQUE(organization_id,installation_number),
 FOREIGN KEY(organization_id,contract_id) REFERENCES contracts(organization_id,id),
 FOREIGN KEY(organization_id,responsible_user_id) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,created_by) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,updated_by) REFERENCES memberships(organization_id,user_id),
 CHECK(status!='scheduled' OR scheduled_on IS NOT NULL),
 CHECK(status!='in_progress' OR started_on IS NOT NULL),
 CHECK(status!='completed' OR (started_on IS NOT NULL AND completed_on IS NOT NULL)),
 CHECK(completed_on IS NULL OR started_on IS NULL OR completed_on>=started_on)
);
CREATE INDEX installations_scope_idx ON installations(organization_id,responsible_user_id,status,created_at DESC);
CREATE INDEX installations_schedule_idx ON installations(organization_id,status,scheduled_on);

CREATE TABLE installation_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, installation_id uuid NOT NULL, actor_id uuid NOT NULL,
 action text NOT NULL CHECK(length(action) BETWEEN 2 AND 80), detail text NOT NULL DEFAULT '' CHECK(length(detail)<=2000),
 snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,installation_id) REFERENCES installations(organization_id,id),
 FOREIGN KEY(organization_id,actor_id) REFERENCES memberships(organization_id,user_id)
);
CREATE INDEX installation_history_idx ON installation_history(organization_id,installation_id,created_at DESC,id DESC);

INSERT INTO permissions(code,description) VALUES
 ('installations.read','Visualizar instalações autorizadas'),
 ('installations.create','Criar instalação para contrato fechado'),
 ('installations.edit','Editar dados e andamento da instalação'),
 ('installations.manage','Gerenciar responsável, conclusão e cancelamento')
ON CONFLICT(code) DO NOTHING;
-- A permissão singular era apenas uma reserva de fase futura. Preserva suas
-- atribuições antes de substituir o código pelo padrão plural do módulo.
INSERT INTO role_permissions(role_code,permission_code)
SELECT role_code,'installations.read' FROM role_permissions WHERE permission_code='installation.read'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_code,permission_code)
SELECT r.code,p.code FROM roles r CROSS JOIN permissions p WHERE
 (r.code IN ('admin','manager') AND p.code IN ('installations.read','installations.create','installations.edit','installations.manage')) OR
 (r.code='seller' AND p.code IN ('installations.read','installations.create','installations.edit')) OR
 (r.code='support' AND p.code='installations.read') OR
 (r.code='technician' AND p.code IN ('installations.read','installations.edit','installations.manage'))
ON CONFLICT DO NOTHING;
DELETE FROM role_permissions WHERE permission_code='installation.read';
DELETE FROM permissions WHERE code='installation.read';

-- As novas tabelas seguem a proteção aplicada às tabelas públicas na 010.
ALTER TABLE installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE installation_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE installations, installation_history FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE installations, installation_history FROM %I',api_role);
  END IF;
 END LOOP;
END $$;
