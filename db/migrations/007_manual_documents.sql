ALTER TABLE crm_opportunities ADD CONSTRAINT crm_opportunities_customer_link_unique UNIQUE(organization_id,id,customer_id);

CREATE TABLE crm_documents (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
 customer_id uuid NOT NULL, customer_kind text NOT NULL DEFAULT 'customer' CHECK(customer_kind='customer'), opportunity_id uuid NOT NULL,
 name text NOT NULL CHECK(length(name) BETWEEN 2 AND 180), budget_value numeric(14,2) NOT NULL CHECK(budget_value>=0),
 valid_until date NOT NULL, notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','accepted','refused')),
 original_filename text NOT NULL CHECK(length(original_filename) BETWEEN 1 AND 180), storage_key text NOT NULL,
 file_size integer NOT NULL CHECK(file_size BETWEEN 1 AND 10485760), content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'),
 version integer NOT NULL DEFAULT 1, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id), UNIQUE(storage_key),
 FOREIGN KEY(organization_id,customer_id,customer_kind) REFERENCES crm_records(organization_id,id,kind),
 FOREIGN KEY(organization_id,opportunity_id,customer_id) REFERENCES crm_opportunities(organization_id,id,customer_id),
 FOREIGN KEY(organization_id,created_by) REFERENCES memberships(organization_id,user_id)
);
CREATE INDEX crm_documents_customer_idx ON crm_documents(organization_id,customer_id,created_at DESC);
CREATE INDEX crm_documents_opportunity_idx ON crm_documents(organization_id,opportunity_id,created_at DESC);

CREATE TABLE crm_document_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, document_id uuid NOT NULL, actor_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('created','updated','status_changed')), snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,document_id) REFERENCES crm_documents(organization_id,id),
 FOREIGN KEY(organization_id,actor_id) REFERENCES memberships(organization_id,user_id)
);
CREATE INDEX crm_document_history_idx ON crm_document_history(organization_id,document_id,created_at DESC,id DESC);
