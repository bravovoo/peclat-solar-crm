CREATE TABLE whatsapp_integrations (
 organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'not_configured' CHECK(status IN ('not_configured','incomplete','connected','error')),
 account_name text NOT NULL DEFAULT '' CHECK(length(account_name)<=180),
 phone_number_id text NOT NULL DEFAULT '' CHECK(length(phone_number_id)<=100),
 business_account_id text NOT NULL DEFAULT '' CHECK(length(business_account_id)<=100),
 display_phone_number text NOT NULL DEFAULT '' CHECK(length(display_phone_number)<=40),
 api_version text NOT NULL DEFAULT '' CHECK(length(api_version)<=30),
 created_by uuid NOT NULL,
 updated_by uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,created_by) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,updated_by) REFERENCES memberships(organization_id,user_id)
);
CREATE UNIQUE INDEX whatsapp_integrations_phone_id_uidx ON whatsapp_integrations(phone_number_id) WHERE phone_number_id<>'';
CREATE UNIQUE INDEX whatsapp_integrations_business_id_uidx ON whatsapp_integrations(business_account_id) WHERE business_account_id<>'';

CREATE TABLE whatsapp_webhook_events (
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 provider_event_id text NOT NULL CHECK(length(provider_event_id) BETWEEN 1 AND 180),
 event_type text NOT NULL CHECK(length(event_type) BETWEEN 1 AND 100),
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
 status text NOT NULL DEFAULT 'received' CHECK(status IN ('received','ignored','processed','failed')),
 received_at timestamptz NOT NULL DEFAULT now(),
 processed_at timestamptz,
 PRIMARY KEY(organization_id,provider_event_id)
);

ALTER TABLE whatsapp_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE whatsapp_integrations,whatsapp_webhook_events FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON TABLE whatsapp_integrations,whatsapp_webhook_events FROM anon;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE ALL ON TABLE whatsapp_integrations,whatsapp_webhook_events FROM authenticated;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  REVOKE ALL ON TABLE whatsapp_integrations,whatsapp_webhook_events FROM service_role;
 END IF;
END $$;
