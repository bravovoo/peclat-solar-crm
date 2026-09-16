CREATE TABLE installation_checklist_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, installation_id uuid NOT NULL,
 code text NOT NULL CHECK(length(code) BETWEEN 2 AND 80), label text NOT NULL CHECK(length(label) BETWEEN 2 AND 180), position integer NOT NULL CHECK(position BETWEEN 1 AND 1000),
 checked boolean NOT NULL DEFAULT false, checked_by uuid, checked_at timestamptz, notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id), UNIQUE(organization_id,installation_id,code), UNIQUE(organization_id,installation_id,position),
 FOREIGN KEY(organization_id,installation_id) REFERENCES installations(organization_id,id),
 FOREIGN KEY(organization_id,checked_by) REFERENCES memberships(organization_id,user_id),
 CHECK(checked=(checked_at IS NOT NULL)), CHECK(checked=(checked_by IS NOT NULL))
);
CREATE INDEX installation_checklist_order_idx ON installation_checklist_items(organization_id,installation_id,position);

-- Instalações criadas antes da 012 recebem o mesmo checklist inicial sem alterar
-- os dados das instalações, contratos ou clientes existentes.
INSERT INTO installation_checklist_items(organization_id,installation_id,code,label,position)
SELECT i.organization_id,i.id,v.code,v.label,v.position FROM installations i CROSS JOIN (VALUES
 ('equipment_checked','Equipamentos conferidos',1),('modules_delivered','Módulos entregues',2),
 ('inverter_checked','Inversor ou microinversor conferido',3),('structure_checked','Estrutura conferida',4),
 ('site_released','Local de instalação liberado',5),('roof_checked','Estrutura e telhado verificados',6),
 ('modules_installed','Módulos instalados',7),('inverter_installed','Inversor instalado',8),
 ('wiring_done','Cabeamento executado',9),('protections_installed','Proteções instaladas',10),
 ('grounding_checked','Aterramento verificado',11),('labels_added','Identificação e etiquetas',12),
 ('area_cleaned','Área limpa',13),('final_test','Teste final realizado',14),
 ('photos_registered','Fotos registradas',15),('client_oriented','Cliente orientado',16)
) AS v(code,label,position) ON CONFLICT(organization_id,installation_id,code) DO NOTHING;

CREATE TABLE installation_files (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, installation_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('photo','document')),
 name text NOT NULL CHECK(length(name) BETWEEN 2 AND 180), description text NOT NULL DEFAULT '' CHECK(length(description)<=2000),
 category text NOT NULL CHECK(length(category) BETWEEN 2 AND 80), original_filename text NOT NULL CHECK(length(original_filename) BETWEEN 1 AND 180),
 mime_type text NOT NULL CHECK(length(mime_type) BETWEEN 4 AND 120), file_size integer NOT NULL CHECK(file_size BETWEEN 1 AND 10485760),
 content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'), storage_key text NOT NULL UNIQUE,
 created_by uuid NOT NULL, deleted_by uuid, deleted_at timestamptz,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id), FOREIGN KEY(organization_id,installation_id) REFERENCES installations(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,deleted_by) REFERENCES memberships(organization_id,user_id),
 CHECK((deleted_at IS NULL)=(deleted_by IS NULL))
);
CREATE INDEX installation_files_list_idx ON installation_files(organization_id,installation_id,kind,created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE installation_issues (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, installation_id uuid NOT NULL,
 title text NOT NULL CHECK(length(title) BETWEEN 2 AND 180), description text NOT NULL DEFAULT '' CHECK(length(description)<=4000),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved','cancelled')),
 priority text NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','critical')),
 responsible_user_id uuid NOT NULL, due_on date, resolved_at timestamptz, resolution_notes text NOT NULL DEFAULT '' CHECK(length(resolution_notes)<=2000),
 created_by uuid NOT NULL, updated_by uuid NOT NULL, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id), FOREIGN KEY(organization_id,installation_id) REFERENCES installations(organization_id,id),
 FOREIGN KEY(organization_id,responsible_user_id) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,created_by) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,updated_by) REFERENCES memberships(organization_id,user_id),
 CHECK((status='resolved')=(resolved_at IS NOT NULL))
);
CREATE INDEX installation_issues_list_idx ON installation_issues(organization_id,installation_id,status,due_on);

CREATE TABLE installation_completions (
 organization_id uuid NOT NULL, installation_id uuid NOT NULL, completed_at timestamptz NOT NULL,
 completed_by uuid NOT NULL, final_notes text NOT NULL DEFAULT '' CHECK(length(final_notes)<=4000),
 checklist_snapshot jsonb NOT NULL, issues_snapshot jsonb NOT NULL, had_open_issues boolean NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,installation_id),
 FOREIGN KEY(organization_id,installation_id) REFERENCES installations(organization_id,id),
 FOREIGN KEY(organization_id,completed_by) REFERENCES memberships(organization_id,user_id)
);

CREATE TABLE installation_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, installation_id uuid NOT NULL,
 delivered_at timestamptz NOT NULL, delivered_by uuid NOT NULL, recipient_name text NOT NULL CHECK(length(recipient_name) BETWEEN 2 AND 180),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000), confirmed boolean NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id), UNIQUE(organization_id,installation_id),
 FOREIGN KEY(organization_id,installation_id) REFERENCES installations(organization_id,id),
 FOREIGN KEY(organization_id,delivered_by) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,created_by) REFERENCES memberships(organization_id,user_id)
);

-- Mesmo isolamento da migration 010/011: apenas o backend PostgreSQL usa estas tabelas.
ALTER TABLE installation_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE installation_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE installation_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE installation_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE installation_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE installation_checklist_items,installation_files,installation_issues,installation_completions,installation_deliveries FROM PUBLIC;
DO $$ DECLARE api_role text; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE installation_checklist_items,installation_files,installation_issues,installation_completions,installation_deliveries FROM %I',api_role);
  END IF;
 END LOOP;
END $$;
