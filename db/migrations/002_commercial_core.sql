CREATE TABLE crm_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 kind text NOT NULL CHECK(kind IN ('lead','customer','company')),
 owner_id uuid NOT NULL, name text NOT NULL CHECK(length(name) BETWEEN 2 AND 180),
 person_type text NOT NULL DEFAULT 'PF' CHECK(person_type IN ('PF','PJ')),
 document text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '', whatsapp text NOT NULL DEFAULT '', email text NOT NULL DEFAULT '',
 postal_code text NOT NULL DEFAULT '', address text NOT NULL DEFAULT '', number text NOT NULL DEFAULT '', complement text NOT NULL DEFAULT '',
 neighborhood text NOT NULL DEFAULT '', city text NOT NULL DEFAULT '', state text NOT NULL DEFAULT '',
 source text NOT NULL DEFAULT 'Manual', campaign text NOT NULL DEFAULT '',
 priority text NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
 temperature text NOT NULL DEFAULT 'warm' CHECK(temperature IN ('cold','warm','hot')),
 stage text NOT NULL DEFAULT 'new' CHECK(stage IN ('new','contact','qualified','awaiting_bill','bill_received','analysis','sizing','budget','proposal','negotiation','documentation','contract','payment','won','lost')),
 potential_value numeric(14,2) NOT NULL DEFAULT 0 CHECK(potential_value>=0), expected_close date,
 observations text NOT NULL DEFAULT '', average_consumption numeric(12,2) CHECK(average_consumption>=0),
 utility text NOT NULL DEFAULT '', property_type text NOT NULL DEFAULT '', roof_type text NOT NULL DEFAULT '',
 consumer_units integer NOT NULL DEFAULT 1 CHECK(consumer_units BETWEEN 1 AND 10000), battery_interest boolean NOT NULL DEFAULT false,
 financing_interest boolean NOT NULL DEFAULT false, trade_name text NOT NULL DEFAULT '', state_registration text NOT NULL DEFAULT '', website text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived','converted')),
 original_lead_id uuid, original_lead_kind text NOT NULL DEFAULT 'lead' CHECK(original_lead_kind='lead'),
 version integer NOT NULL DEFAULT 1, deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id), UNIQUE(organization_id,id,kind), UNIQUE(organization_id,original_lead_id),
 FOREIGN KEY(organization_id,owner_id) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,original_lead_id,original_lead_kind) REFERENCES crm_records(organization_id,id,kind),
 CHECK(original_lead_id IS NULL OR kind='customer'), CHECK(kind!='company' OR person_type='PJ')
);
CREATE INDEX crm_records_scope_idx ON crm_records(organization_id,owner_id,kind,created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX crm_records_list_idx ON crm_records(organization_id,kind,status,created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX crm_records_email_idx ON crm_records(organization_id,email) WHERE email!='';
CREATE INDEX crm_records_document_idx ON crm_records(organization_id,document) WHERE document!='';
CREATE INDEX crm_records_phone_idx ON crm_records(organization_id,phone) WHERE phone!='';
CREATE INDEX crm_records_whatsapp_idx ON crm_records(organization_id,whatsapp) WHERE whatsapp!='';
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX crm_records_search_idx ON crm_records USING gin ((lower(name || ' ' || trade_name || ' ' || email || ' ' || phone || ' ' || whatsapp || ' ' || document || ' ' || city)) gin_trgm_ops) WHERE deleted_at IS NULL;
CREATE TABLE crm_tags (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 40), color text NOT NULL DEFAULT '#195ca0' CHECK(color ~ '^#[0-9a-fA-F]{6}$'),
 UNIQUE(organization_id,id)
);
CREATE UNIQUE INDEX crm_tags_name_idx ON crm_tags(organization_id,lower(name));
CREATE TABLE crm_record_tags (
 organization_id uuid NOT NULL, record_id uuid NOT NULL, tag_id uuid NOT NULL,
 PRIMARY KEY(organization_id,record_id,tag_id),
 FOREIGN KEY(organization_id,record_id) REFERENCES crm_records(organization_id,id),
 FOREIGN KEY(organization_id,tag_id) REFERENCES crm_tags(organization_id,id) ON DELETE CASCADE
);
CREATE INDEX crm_record_tags_filter_idx ON crm_record_tags(organization_id,tag_id,record_id);
CREATE TABLE crm_contacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES organizations(id),name text NOT NULL,
 job_title text NOT NULL DEFAULT '',phone text NOT NULL DEFAULT '',whatsapp text NOT NULL DEFAULT '',email text NOT NULL DEFAULT '',
 observations text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,id)
);
CREATE TABLE crm_record_contacts (
 organization_id uuid NOT NULL,record_id uuid NOT NULL,contact_id uuid NOT NULL,is_primary boolean NOT NULL DEFAULT false,
 PRIMARY KEY(organization_id,record_id,contact_id),
 FOREIGN KEY(organization_id,record_id) REFERENCES crm_records(organization_id,id),
 FOREIGN KEY(organization_id,contact_id) REFERENCES crm_contacts(organization_id,id)
);
CREATE UNIQUE INDEX crm_primary_contact_idx ON crm_record_contacts(organization_id,record_id) WHERE is_primary;
CREATE INDEX crm_contact_links_idx ON crm_record_contacts(organization_id,contact_id);
CREATE TABLE crm_notes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL,record_id uuid NOT NULL,actor_id uuid NOT NULL,
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 4000),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,record_id) REFERENCES crm_records(organization_id,id),
 FOREIGN KEY(organization_id,actor_id) REFERENCES memberships(organization_id,user_id),UNIQUE(organization_id,id)
);
CREATE INDEX crm_notes_record_idx ON crm_notes(organization_id,record_id,created_at DESC);
CREATE TABLE crm_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL,record_id uuid NOT NULL,owner_id uuid NOT NULL,
 title text NOT NULL CHECK(length(title) BETWEEN 2 AND 180),due_at timestamptz NOT NULL,completed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,record_id) REFERENCES crm_records(organization_id,id),
 FOREIGN KEY(organization_id,owner_id) REFERENCES memberships(organization_id,user_id),UNIQUE(organization_id,id)
);
CREATE INDEX crm_tasks_record_idx ON crm_tasks(organization_id,record_id,due_at);
CREATE TABLE crm_activities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL,record_id uuid NOT NULL,actor_id uuid NOT NULL,
 action text NOT NULL,detail text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,record_id) REFERENCES crm_records(organization_id,id),
 FOREIGN KEY(organization_id,actor_id) REFERENCES memberships(organization_id,user_id)
);
CREATE INDEX crm_activities_record_idx ON crm_activities(organization_id,record_id,created_at DESC);
INSERT INTO permissions(code,description) VALUES ('crm.duplicate.override','Confirmar cadastros duplicados'),('crm.delete','Excluir cadastros'),('crm.tags.manage','Configurar tags') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_code,permission_code) SELECT r.code,p.code FROM roles r CROSS JOIN permissions p WHERE (r.code='admin' AND p.code IN ('crm.duplicate.override','crm.delete','crm.tags.manage')) OR (r.code='manager' AND p.code IN ('crm.duplicate.override','crm.delete')) ON CONFLICT DO NOTHING;
