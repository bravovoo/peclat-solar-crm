CREATE TABLE post_sales_ticket_sequences (
 organization_id uuid NOT NULL REFERENCES organizations(id), year integer NOT NULL CHECK(year BETWEEN 2000 AND 9999),
 last_value integer NOT NULL CHECK(last_value>0), PRIMARY KEY(organization_id,year)
);

CREATE TABLE post_sales_warranties (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), installation_id uuid NOT NULL,
 contract_item_id uuid, category text NOT NULL CHECK(category IN ('module','inverter','microinverter','structure','labor','auxiliary','other')),
 description text NOT NULL CHECK(length(description) BETWEEN 2 AND 500), manufacturer text NOT NULL DEFAULT '' CHECK(length(manufacturer)<=180),
 serial_number text NOT NULL DEFAULT '' CHECK(length(serial_number)<=180), supplier text NOT NULL DEFAULT '' CHECK(length(supplier)<=180),
 start_on date NOT NULL, duration_months integer NOT NULL CHECK(duration_months BETWEEN 1 AND 600), end_on date NOT NULL,
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000), lifecycle text NOT NULL DEFAULT 'normal' CHECK(lifecycle IN ('normal','claimed','closed','cancelled')),
 responsible_user_id uuid NOT NULL, created_by uuid NOT NULL, updated_by uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id), UNIQUE(organization_id,id,installation_id),
 FOREIGN KEY(organization_id,installation_id) REFERENCES installations(organization_id,id),
 FOREIGN KEY(organization_id,contract_item_id) REFERENCES contract_items(organization_id,id),
 FOREIGN KEY(organization_id,responsible_user_id) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,created_by) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,updated_by) REFERENCES memberships(organization_id,user_id),
 CHECK(end_on>=start_on)
);
CREATE INDEX post_sales_warranties_installation_idx ON post_sales_warranties(organization_id,installation_id,end_on);
CREATE INDEX post_sales_warranties_expiry_idx ON post_sales_warranties(organization_id,lifecycle,end_on);

CREATE TABLE post_sales_tickets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), client_id uuid NOT NULL,
 contract_id uuid, installation_id uuid, warranty_id uuid, contract_item_id uuid,
 ticket_number text NOT NULL CHECK(length(ticket_number) BETWEEN 8 AND 50),
 title text NOT NULL CHECK(length(title) BETWEEN 2 AND 180), description text NOT NULL DEFAULT '' CHECK(length(description)<=4000),
 category text NOT NULL CHECK(category IN ('question','installation','generation','equipment','inverter','module','electrical','structure','warranty','maintenance','financial','documentation','other')),
 priority text NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','critical')),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','analysis','waiting_customer','waiting_supplier','waiting_part','scheduled','in_service','resolved','closed','cancelled')),
 responsible_user_id uuid NOT NULL, opened_at timestamptz NOT NULL DEFAULT now(), due_on date, attended_at timestamptz, resolved_at timestamptz,
 resolution text NOT NULL DEFAULT '' CHECK(length(resolution)<=4000), created_by uuid NOT NULL, updated_by uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id), UNIQUE(organization_id,id,installation_id), UNIQUE(organization_id,ticket_number),
 FOREIGN KEY(organization_id,client_id) REFERENCES crm_records(organization_id,id),
 FOREIGN KEY(organization_id,contract_id,client_id) REFERENCES contracts(organization_id,id,client_id),
 FOREIGN KEY(organization_id,installation_id) REFERENCES installations(organization_id,id),
 FOREIGN KEY(organization_id,warranty_id,installation_id) REFERENCES post_sales_warranties(organization_id,id,installation_id),
 FOREIGN KEY(organization_id,contract_item_id) REFERENCES contract_items(organization_id,id),
 FOREIGN KEY(organization_id,responsible_user_id) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,created_by) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,updated_by) REFERENCES memberships(organization_id,user_id),
 CHECK(installation_id IS NULL OR contract_id IS NOT NULL), CHECK(warranty_id IS NULL OR installation_id IS NOT NULL),
 CHECK(status NOT IN ('resolved','closed') OR (resolved_at IS NOT NULL AND length(resolution)>0)),
 CHECK(resolved_at IS NULL OR status IN ('resolved','closed'))
);
CREATE INDEX post_sales_tickets_scope_idx ON post_sales_tickets(organization_id,responsible_user_id,status,created_at DESC);
CREATE INDEX post_sales_tickets_client_idx ON post_sales_tickets(organization_id,client_id,created_at DESC);
CREATE INDEX post_sales_tickets_installation_idx ON post_sales_tickets(organization_id,installation_id,created_at DESC);
CREATE INDEX post_sales_tickets_search_idx ON post_sales_tickets(organization_id,ticket_number);

CREATE TABLE post_sales_ticket_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, ticket_id uuid NOT NULL, actor_id uuid NOT NULL,
 action text NOT NULL CHECK(length(action) BETWEEN 2 AND 80), detail text NOT NULL DEFAULT '' CHECK(length(detail)<=4000),
 snapshot jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,ticket_id) REFERENCES post_sales_tickets(organization_id,id),
 FOREIGN KEY(organization_id,actor_id) REFERENCES memberships(organization_id,user_id)
);
CREATE INDEX post_sales_ticket_history_idx ON post_sales_ticket_history(organization_id,ticket_id,created_at DESC,id DESC);

CREATE TABLE post_sales_warranty_claims (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, warranty_id uuid NOT NULL, ticket_id uuid NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 2 AND 4000), supplier text NOT NULL DEFAULT '' CHECK(length(supplier)<=180),
 protocol text NOT NULL DEFAULT '' CHECK(length(protocol)<=180), notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000),
 status text NOT NULL DEFAULT 'awaiting_send' CHECK(status IN ('awaiting_send','sent','analysis','approved','rejected','replacement','repair','closed')),
 result text NOT NULL DEFAULT '' CHECK(length(result)<=4000), closed_at timestamptz, responsible_user_id uuid NOT NULL,
 created_by uuid NOT NULL, updated_by uuid NOT NULL, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id), FOREIGN KEY(organization_id,warranty_id) REFERENCES post_sales_warranties(organization_id,id),
 FOREIGN KEY(organization_id,ticket_id) REFERENCES post_sales_tickets(organization_id,id),
 FOREIGN KEY(organization_id,responsible_user_id) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,created_by) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,updated_by) REFERENCES memberships(organization_id,user_id),
 CHECK((status='closed')=(closed_at IS NOT NULL))
);
CREATE INDEX post_sales_claims_warranty_idx ON post_sales_warranty_claims(organization_id,warranty_id,created_at DESC);
CREATE INDEX post_sales_claims_ticket_idx ON post_sales_warranty_claims(organization_id,ticket_id);

CREATE TABLE post_sales_maintenances (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, installation_id uuid NOT NULL,
 ticket_id uuid, warranty_id uuid, type text NOT NULL CHECK(type IN ('preventive','corrective','inspection','cleaning','replacement','adjustment','diagnostic','other')),
 reason text NOT NULL CHECK(length(reason) BETWEEN 2 AND 500), description text NOT NULL DEFAULT '' CHECK(length(description)<=4000),
 responsible_user_id uuid NOT NULL, planned_on date, scheduled_on date, executed_on date,
 status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','scheduled','in_progress','completed','cancelled')),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000), resolution text NOT NULL DEFAULT '' CHECK(length(resolution)<=4000),
 internal_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK(internal_cost>=0), charged_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK(charged_amount>=0),
 no_charge boolean NOT NULL DEFAULT false, financial_notes text NOT NULL DEFAULT '' CHECK(length(financial_notes)<=2000),
 created_by uuid NOT NULL, updated_by uuid NOT NULL, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id), FOREIGN KEY(organization_id,installation_id) REFERENCES installations(organization_id,id),
 FOREIGN KEY(organization_id,ticket_id,installation_id) REFERENCES post_sales_tickets(organization_id,id,installation_id),
 FOREIGN KEY(organization_id,warranty_id,installation_id) REFERENCES post_sales_warranties(organization_id,id,installation_id),
 FOREIGN KEY(organization_id,responsible_user_id) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,created_by) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,updated_by) REFERENCES memberships(organization_id,user_id),
 CHECK(status!='scheduled' OR scheduled_on IS NOT NULL), CHECK(status!='completed' OR (executed_on IS NOT NULL AND length(resolution)>0)),
 CHECK(NOT no_charge OR charged_amount=0)
);
CREATE INDEX post_sales_maintenances_installation_idx ON post_sales_maintenances(organization_id,installation_id,status,created_at DESC);
CREATE INDEX post_sales_maintenances_schedule_idx ON post_sales_maintenances(organization_id,status,scheduled_on);

CREATE TABLE post_sales_maintenance_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, maintenance_id uuid NOT NULL,
 description text NOT NULL CHECK(length(description) BETWEEN 2 AND 500), quantity numeric(12,3) NOT NULL CHECK(quantity>0 AND quantity<=1000000),
 equipment_id uuid, notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000), created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,maintenance_id) REFERENCES post_sales_maintenances(organization_id,id),
 FOREIGN KEY(organization_id,equipment_id) REFERENCES solar_equipment(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES memberships(organization_id,user_id)
);
CREATE INDEX post_sales_maintenance_items_idx ON post_sales_maintenance_items(organization_id,maintenance_id,created_at);

CREATE TABLE post_sales_files (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
 warranty_id uuid, ticket_id uuid, maintenance_id uuid,
 name text NOT NULL CHECK(length(name) BETWEEN 2 AND 180), description text NOT NULL DEFAULT '' CHECK(length(description)<=2000),
 category text NOT NULL CHECK(length(category) BETWEEN 2 AND 80), original_filename text NOT NULL CHECK(length(original_filename) BETWEEN 1 AND 180),
 mime_type text NOT NULL CHECK(length(mime_type) BETWEEN 4 AND 120), file_size integer NOT NULL CHECK(file_size BETWEEN 1 AND 10485760),
 content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'), storage_key text NOT NULL UNIQUE,
 created_by uuid NOT NULL, deleted_by uuid, deleted_at timestamptz, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id), FOREIGN KEY(organization_id,warranty_id) REFERENCES post_sales_warranties(organization_id,id),
 FOREIGN KEY(organization_id,ticket_id) REFERENCES post_sales_tickets(organization_id,id),
 FOREIGN KEY(organization_id,maintenance_id) REFERENCES post_sales_maintenances(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,deleted_by) REFERENCES memberships(organization_id,user_id),
 CHECK(num_nonnulls(warranty_id,ticket_id,maintenance_id)=1), CHECK((deleted_at IS NULL)=(deleted_by IS NULL))
);
CREATE INDEX post_sales_files_warranty_idx ON post_sales_files(organization_id,warranty_id,created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX post_sales_files_ticket_idx ON post_sales_files(organization_id,ticket_id,created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX post_sales_files_maintenance_idx ON post_sales_files(organization_id,maintenance_id,created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE post_sales_task_links (
 organization_id uuid NOT NULL, task_id uuid NOT NULL, ticket_id uuid, maintenance_id uuid,
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,task_id),
 FOREIGN KEY(organization_id,task_id) REFERENCES crm_tasks(organization_id,id),
 FOREIGN KEY(organization_id,ticket_id) REFERENCES post_sales_tickets(organization_id,id),
 FOREIGN KEY(organization_id,maintenance_id) REFERENCES post_sales_maintenances(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES memberships(organization_id,user_id),
 CHECK(num_nonnulls(ticket_id,maintenance_id)=1)
);
CREATE INDEX post_sales_task_links_ticket_idx ON post_sales_task_links(organization_id,ticket_id);
CREATE INDEX post_sales_task_links_maintenance_idx ON post_sales_task_links(organization_id,maintenance_id);

INSERT INTO permissions(code,description) VALUES
 ('post_sales.read','Visualizar pós-venda autorizado'),('post_sales.create','Criar garantias, chamados e manutenções'),
 ('post_sales.edit','Atualizar pós-venda e atendimento'),('post_sales.manage','Gerenciar encerramentos e exclusão de anexos') ON CONFLICT(code) DO NOTHING;
INSERT INTO roles(code,name) VALUES ('postsales','Pós-venda') ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_code,permission_code)
SELECT r.code,p.code FROM roles r CROSS JOIN permissions p WHERE
 (r.code IN ('admin','manager','postsales') AND p.code IN ('post_sales.read','post_sales.create','post_sales.edit','post_sales.manage')) OR
 (r.code IN ('support','technician') AND p.code IN ('post_sales.read','post_sales.create','post_sales.edit')) OR
 (r.code='seller' AND p.code IN ('post_sales.read','post_sales.create'))
ON CONFLICT DO NOTHING;

ALTER TABLE post_sales_ticket_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_sales_warranties ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_sales_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_sales_ticket_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_sales_warranty_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_sales_maintenances ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_sales_maintenance_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_sales_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_sales_task_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE post_sales_ticket_sequences,post_sales_warranties,post_sales_tickets,post_sales_ticket_history,post_sales_warranty_claims,post_sales_maintenances,post_sales_maintenance_items,post_sales_files,post_sales_task_links FROM PUBLIC;
DO $$ DECLARE api_role text; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE post_sales_ticket_sequences,post_sales_warranties,post_sales_tickets,post_sales_ticket_history,post_sales_warranty_claims,post_sales_maintenances,post_sales_maintenance_items,post_sales_files,post_sales_task_links FROM %I',api_role);
  END IF;
 END LOOP;
END $$;
