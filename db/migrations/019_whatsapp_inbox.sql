ALTER TABLE whatsapp_integrations
 ADD COLUMN webhook_status text NOT NULL DEFAULT 'awaiting_event' CHECK(webhook_status IN ('awaiting_event','receiving','error')),
 ADD COLUMN last_event_at timestamptz,
 ADD COLUMN last_event_type text NOT NULL DEFAULT '' CHECK(length(last_event_type)<=100);

CREATE TABLE whatsapp_conversations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 external_wa_id text NOT NULL CHECK(external_wa_id ~ '^[1-9][0-9]{7,14}$'),
 phone_e164 text NOT NULL CHECK(phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
 profile_name text NOT NULL DEFAULT '' CHECK(length(profile_name)<=180),
 last_message_preview text NOT NULL DEFAULT '' CHECK(length(last_message_preview)<=500),
 last_message_type text NOT NULL DEFAULT 'unknown' CHECK(length(last_message_type)<=30),
 last_message_at timestamptz,
 unread_count integer NOT NULL DEFAULT 0 CHECK(unread_count>=0),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','archived')),
 record_id uuid,
 link_status text NOT NULL DEFAULT 'unidentified' CHECK(link_status IN ('identified','unidentified','ambiguous')),
 link_source text NOT NULL DEFAULT 'none' CHECK(link_source IN ('none','automatic','manual')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,external_wa_id),
 FOREIGN KEY(organization_id) REFERENCES whatsapp_integrations(organization_id) ON DELETE CASCADE,
 FOREIGN KEY(organization_id,record_id) REFERENCES crm_records(organization_id,id)
);
CREATE INDEX whatsapp_conversations_inbox_idx ON whatsapp_conversations(organization_id,status,last_message_at DESC,id);
CREATE INDEX whatsapp_conversations_unread_idx ON whatsapp_conversations(organization_id,last_message_at DESC) WHERE unread_count>0;
CREATE INDEX whatsapp_conversations_record_idx ON whatsapp_conversations(organization_id,record_id,last_message_at DESC) WHERE record_id IS NOT NULL;

CREATE TABLE whatsapp_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL,
 meta_message_id text NOT NULL CHECK(length(meta_message_id) BETWEEN 1 AND 240),
 direction text NOT NULL DEFAULT 'inbound' CHECK(direction='inbound'),
 message_type text NOT NULL CHECK(message_type IN ('text','image','document','audio','video','sticker','location','contacts','reaction','interactive','unknown')),
 text_body text NOT NULL DEFAULT '' CHECK(length(text_body)<=16000),
 sender_wa_id text NOT NULL CHECK(sender_wa_id ~ '^[1-9][0-9]{7,14}$'),
 context_message_id text NOT NULL DEFAULT '' CHECK(length(context_message_id)<=240),
 media_id text NOT NULL DEFAULT '' CHECK(length(media_id)<=240),
 mime_type text NOT NULL DEFAULT '' CHECK(length(mime_type)<=180),
 filename text NOT NULL DEFAULT '' CHECK(length(filename)<=255),
 caption text NOT NULL DEFAULT '' CHECK(length(caption)<=2000),
 safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(octet_length(safe_metadata::text)<=8192),
 meta_timestamp timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),
 processing_status text NOT NULL DEFAULT 'received' CHECK(processing_status IN ('received','processed','unsupported')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,meta_message_id),
 FOREIGN KEY(organization_id,conversation_id) REFERENCES whatsapp_conversations(organization_id,id) ON DELETE CASCADE
);
CREATE INDEX whatsapp_messages_conversation_idx ON whatsapp_messages(organization_id,conversation_id,meta_timestamp,id);

ALTER TABLE whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE whatsapp_conversations,whatsapp_messages FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON TABLE whatsapp_conversations,whatsapp_messages FROM anon;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE ALL ON TABLE whatsapp_conversations,whatsapp_messages FROM authenticated;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  REVOKE ALL ON TABLE whatsapp_conversations,whatsapp_messages FROM service_role;
 END IF;
END $$;
