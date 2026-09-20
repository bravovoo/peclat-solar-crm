ALTER TABLE whatsapp_conversations
 ADD COLUMN last_inbound_at timestamptz;

UPDATE whatsapp_conversations c
SET last_inbound_at=source.last_inbound_at
FROM (
 SELECT organization_id,conversation_id,max(meta_timestamp) last_inbound_at
 FROM whatsapp_messages
 WHERE direction='inbound'
 GROUP BY organization_id,conversation_id
) source
WHERE c.organization_id=source.organization_id AND c.id=source.conversation_id;

ALTER TABLE whatsapp_messages
 DROP CONSTRAINT whatsapp_messages_direction_check,
 DROP CONSTRAINT whatsapp_messages_message_type_check,
 DROP CONSTRAINT whatsapp_messages_meta_message_id_check,
 DROP CONSTRAINT whatsapp_messages_sender_wa_id_check,
 ALTER COLUMN meta_message_id DROP NOT NULL,
 ADD COLUMN sent_by uuid,
 ADD COLUMN client_request_id uuid,
 ADD COLUMN template_id uuid,
 ADD COLUMN template_name text NOT NULL DEFAULT '' CHECK(length(template_name)<=512),
 ADD COLUMN template_language text NOT NULL DEFAULT '' CHECK(length(template_language)<=35),
 ADD COLUMN template_parameters jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(octet_length(template_parameters::text)<=8192),
 ADD COLUMN delivery_status text,
 ADD COLUMN sent_at timestamptz,
 ADD COLUMN delivered_at timestamptz,
 ADD COLUMN read_at timestamptz,
 ADD COLUMN failed_at timestamptz,
 ADD COLUMN outcome_uncertain boolean NOT NULL DEFAULT false,
 ADD COLUMN failure_code text NOT NULL DEFAULT '' CHECK(length(failure_code)<=80),
 ADD COLUMN failure_title text NOT NULL DEFAULT '' CHECK(length(failure_title)<=180),
 ADD COLUMN failure_detail text NOT NULL DEFAULT '' CHECK(length(failure_detail)<=500),
 ADD CHECK(direction IN ('inbound','outbound')),
 ADD CHECK(message_type IN ('text','template','image','document','audio','video','sticker','location','contacts','reaction','interactive','unknown')),
 ADD CHECK(meta_message_id IS NULL OR length(meta_message_id) BETWEEN 1 AND 240),
 ADD CHECK((direction='inbound' AND sender_wa_id ~ '^[1-9][0-9]{7,14}$') OR (direction='outbound' AND sender_wa_id='')),
 ADD CHECK(delivery_status IS NULL OR delivery_status IN ('pending','sent','delivered','read','failed')),
 ADD CHECK((direction='inbound' AND client_request_id IS NULL AND sent_by IS NULL AND delivery_status IS NULL) OR
           (direction='outbound' AND client_request_id IS NOT NULL AND sent_by IS NOT NULL AND delivery_status IS NOT NULL)),
 ADD FOREIGN KEY(organization_id,sent_by) REFERENCES memberships(organization_id,user_id);

CREATE UNIQUE INDEX whatsapp_messages_client_request_uidx
 ON whatsapp_messages(organization_id,client_request_id)
 WHERE client_request_id IS NOT NULL;
CREATE INDEX whatsapp_messages_delivery_idx
 ON whatsapp_messages(organization_id,delivery_status,meta_timestamp DESC)
 WHERE direction='outbound';

CREATE TABLE whatsapp_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 meta_template_id text NOT NULL CHECK(length(meta_template_id) BETWEEN 1 AND 180),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 512),
 language text NOT NULL CHECK(length(language) BETWEEN 1 AND 35),
 category text NOT NULL DEFAULT '' CHECK(length(category)<=50),
 status text NOT NULL CHECK(status IN ('APPROVED','PENDING','REJECTED','PAUSED','DISABLED','IN_APPEAL','PENDING_DELETION','DELETED','LIMIT_EXCEEDED','UNKNOWN')),
 components jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(components)='array' AND octet_length(components::text)<=32768),
 supported boolean NOT NULL DEFAULT false,
 unsupported_reason text NOT NULL DEFAULT '' CHECK(length(unsupported_reason)<=300),
 synced_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,meta_template_id),
 UNIQUE(organization_id,name,language),
 FOREIGN KEY(organization_id) REFERENCES whatsapp_integrations(organization_id) ON DELETE CASCADE
);
CREATE INDEX whatsapp_templates_available_idx ON whatsapp_templates(organization_id,name,language) WHERE status='APPROVED';

ALTER TABLE whatsapp_messages
 ADD FOREIGN KEY(organization_id,template_id) REFERENCES whatsapp_templates(organization_id,id);

ALTER TABLE whatsapp_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE whatsapp_templates FROM PUBLIC;
DO $$ DECLARE api_role text; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE whatsapp_templates FROM %I',api_role);
  END IF;
 END LOOP;
END $$;
