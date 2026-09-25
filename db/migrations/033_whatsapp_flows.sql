INSERT INTO permissions(code,description) VALUES
 ('whatsapp.flows.manage','Gerenciar WhatsApp Flows oficiais')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_code,permission_code)
SELECT roles.code,permissions.code FROM roles CROSS JOIN permissions
WHERE roles.code='admin' AND permissions.code='whatsapp.flows.manage'
ON CONFLICT DO NOTHING;

CREATE TABLE whatsapp_flows (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 meta_flow_id text,
 technical_name text NOT NULL CHECK(technical_name ~ '^[a-z0-9_]{3,200}$'),
 display_name text NOT NULL CHECK(length(display_name) BETWEEN 3 AND 180),
 category text NOT NULL DEFAULT 'LEAD_GENERATION' CHECK(category IN ('SIGN_UP','SIGN_IN','APPOINTMENT_BOOKING','LEAD_GENERATION','CONTACT_US','CUSTOMER_SUPPORT','SURVEY','OTHER')),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','DEPRECATED','BLOCKED','THROTTLED','UNKNOWN')),
 json_version text NOT NULL DEFAULT '7.3' CHECK(length(json_version) BETWEEN 1 AND 20),
 data_api_version text NOT NULL DEFAULT '3.0' CHECK(length(data_api_version) BETWEEN 1 AND 20),
 flow_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(flow_json)='object'),
 validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(validation_errors)='array'),
 health_status jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(health_status)='object'),
 preview_url text NOT NULL DEFAULT '' CHECK(length(preview_url)<=3000),
 endpoint_uri text NOT NULL DEFAULT '' CHECK(length(endpoint_uri)<=1000),
 safe_error text NOT NULL DEFAULT '' CHECK(length(safe_error)<=1000),
 outcome_uncertain boolean NOT NULL DEFAULT false,
 published_at timestamptz,
 synced_at timestamptz,
 created_by uuid REFERENCES users(id),
 updated_by uuid REFERENCES users(id),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,technical_name),
 CHECK(meta_flow_id IS NULL OR length(meta_flow_id) BETWEEN 1 AND 180)
);
CREATE UNIQUE INDEX whatsapp_flows_meta_uidx ON whatsapp_flows(organization_id,meta_flow_id) WHERE meta_flow_id IS NOT NULL;
CREATE INDEX whatsapp_flows_status_idx ON whatsapp_flows(organization_id,status,updated_at DESC,id);

CREATE TABLE whatsapp_flow_field_mappings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 flow_id uuid NOT NULL,
 flow_field text NOT NULL CHECK(flow_field ~ '^[a-z][a-z0-9_]{0,79}$'),
 crm_field text NOT NULL CHECK(crm_field IN ('name','city','state','property_type','average_bill','has_bill','property_owned','commercial_interest','technical_visit','preferred_contact_period','observations')),
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 100),
 enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,flow_id,flow_field),
 UNIQUE(organization_id,flow_id,crm_field),
 FOREIGN KEY(organization_id,flow_id) REFERENCES whatsapp_flows(organization_id,id) ON DELETE CASCADE
);
CREATE INDEX whatsapp_flow_mappings_idx ON whatsapp_flow_field_mappings(organization_id,flow_id,enabled,crm_field);

CREATE TABLE whatsapp_flow_submissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 flow_id uuid NOT NULL,
 conversation_id uuid NOT NULL,
 message_id uuid NOT NULL,
 record_id uuid,
 provider_submission_id text NOT NULL CHECK(length(provider_submission_id) BETWEEN 1 AND 240),
 flow_token text NOT NULL DEFAULT '' CHECK(length(flow_token)<=500),
 normalized_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(normalized_payload)='object'),
 audit_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(audit_payload)='object'),
 processing_result text NOT NULL CHECK(processing_result IN ('lead_created','lead_updated','customer_linked','company_linked','ambiguous_contact','invalid_data')),
 received_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,provider_submission_id),
 UNIQUE(organization_id,message_id),
 FOREIGN KEY(organization_id,flow_id) REFERENCES whatsapp_flows(organization_id,id),
 FOREIGN KEY(organization_id,conversation_id) REFERENCES whatsapp_conversations(organization_id,id) ON DELETE CASCADE,
 FOREIGN KEY(organization_id,message_id) REFERENCES whatsapp_messages(organization_id,id) ON DELETE CASCADE,
 FOREIGN KEY(organization_id,record_id) REFERENCES crm_records(organization_id,id)
);
CREATE INDEX whatsapp_flow_submissions_flow_idx ON whatsapp_flow_submissions(organization_id,flow_id,received_at DESC,id);
CREATE INDEX whatsapp_flow_submissions_record_idx ON whatsapp_flow_submissions(organization_id,record_id,received_at DESC) WHERE record_id IS NOT NULL;

ALTER TABLE whatsapp_messages ADD COLUMN flow_submission_id uuid;
ALTER TABLE whatsapp_messages ADD FOREIGN KEY(organization_id,flow_submission_id) REFERENCES whatsapp_flow_submissions(organization_id,id);

ALTER TABLE whatsapp_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_flow_field_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_flow_submissions ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE whatsapp_flows,whatsapp_flow_field_mappings,whatsapp_flow_submissions FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
 FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
  EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE whatsapp_flows,whatsapp_flow_field_mappings,whatsapp_flow_submissions FROM %I',api_role);
 END LOOP;
END $$;
