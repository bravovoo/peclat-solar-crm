ALTER TABLE crm_document_emails
 ADD COLUMN client_request_id uuid DEFAULT gen_random_uuid(),
 ADD COLUMN status text NOT NULL DEFAULT 'sent' CHECK(status IN ('pending','sent','failed')),
 ADD COLUMN attempts integer NOT NULL DEFAULT 1 CHECK(attempts BETWEEN 1 AND 20),
 ADD COLUMN safe_error text NOT NULL DEFAULT '' CHECK(length(safe_error)<=500),
 ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

UPDATE crm_document_emails SET client_request_id=id WHERE client_request_id IS NULL;
ALTER TABLE crm_document_emails ALTER COLUMN client_request_id SET NOT NULL;
ALTER TABLE crm_document_emails ALTER COLUMN sent_at DROP NOT NULL;
CREATE UNIQUE INDEX crm_document_emails_request_uidx ON crm_document_emails(organization_id,document_id,client_request_id);

CREATE TABLE whatsapp_webhook_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
 raw_payload text NOT NULL CHECK(octet_length(raw_payload)<=1048576),
 signature text NOT NULL CHECK(signature ~ '^sha256=[0-9a-f]{64}$'),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 10),
 scheduled_for timestamptz NOT NULL DEFAULT now(),
 locked_at timestamptz,
 completed_at timestamptz,
 safe_error text NOT NULL DEFAULT '' CHECK(length(safe_error)<=500),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,payload_sha256)
);
CREATE INDEX whatsapp_webhook_batches_due_idx ON whatsapp_webhook_batches(status,scheduled_for,id) WHERE status='pending';

CREATE TABLE storage_deletion_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 source_type text NOT NULL CHECK(source_type IN ('installation_file','post_sales_file')),
 source_id uuid NOT NULL,
 storage_key text NOT NULL CHECK(length(storage_key) BETWEEN 10 AND 1000),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed','cancelled')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 10),
 scheduled_for timestamptz NOT NULL DEFAULT now(),
 locked_at timestamptz,
 completed_at timestamptz,
 safe_error text NOT NULL DEFAULT '' CHECK(length(safe_error)<=500),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,source_type,source_id,storage_key)
);
CREATE INDEX storage_deletion_jobs_due_idx ON storage_deletion_jobs(status,scheduled_for,id) WHERE status='pending';

ALTER TABLE whatsapp_webhook_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_deletion_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE whatsapp_webhook_batches,storage_deletion_jobs FROM PUBLIC;
DO $$ DECLARE api_role text; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE whatsapp_webhook_batches,storage_deletion_jobs FROM %I',api_role);
  END IF;
 END LOOP;
END $$;
