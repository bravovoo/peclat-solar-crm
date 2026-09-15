CREATE TABLE crm_document_emails (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, document_id uuid NOT NULL,
 customer_id uuid NOT NULL, opportunity_id uuid NOT NULL, actor_id uuid NOT NULL,
 recipient text NOT NULL CHECK(length(recipient) BETWEEN 3 AND 254), subject text NOT NULL CHECK(length(subject) BETWEEN 1 AND 180),
 message text NOT NULL CHECK(length(message) BETWEEN 1 AND 10000), document_name text NOT NULL CHECK(length(document_name) BETWEEN 2 AND 180),
 original_filename text NOT NULL CHECK(length(original_filename) BETWEEN 1 AND 180), provider_message_id text NOT NULL DEFAULT '' CHECK(length(provider_message_id)<=500),
 sent_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,document_id) REFERENCES crm_documents(organization_id,id),
 FOREIGN KEY(organization_id,customer_id) REFERENCES crm_records(organization_id,id),
 FOREIGN KEY(organization_id,opportunity_id,customer_id) REFERENCES crm_opportunities(organization_id,id,customer_id),
 FOREIGN KEY(organization_id,actor_id) REFERENCES memberships(organization_id,user_id)
);
CREATE INDEX crm_document_emails_document_idx ON crm_document_emails(organization_id,document_id,sent_at DESC,id DESC);
CREATE INDEX crm_document_emails_customer_idx ON crm_document_emails(organization_id,customer_id,sent_at DESC);
CREATE INDEX crm_document_emails_opportunity_idx ON crm_document_emails(organization_id,opportunity_id,sent_at DESC);
