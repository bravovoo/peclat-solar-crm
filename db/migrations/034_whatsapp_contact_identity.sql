CREATE OR REPLACE FUNCTION crm_normalize_whatsapp_number(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  WITH cleaned AS (
    SELECT regexp_replace(COALESCE(value,''),'[^0-9]','','g') digits,
           trim(COALESCE(value,'')) raw
  )
  SELECT CASE
    WHEN left(raw,2)='00' THEN substr(digits,3)
    WHEN left(raw,1)<>'+' AND length(digits) IN (10,11) THEN '55'||digits
    ELSE digits
  END
  FROM cleaned
$$;

CREATE TABLE crm_whatsapp_identities (
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 wa_id text NOT NULL CHECK(wa_id ~ '^[1-9][0-9]{7,14}$'),
 phone_e164 text NOT NULL CHECK(phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
 record_id uuid NOT NULL,
 profile_name text NOT NULL DEFAULT '' CHECK(length(profile_name)<=180),
 source text NOT NULL DEFAULT 'inbound' CHECK(source IN ('inbound','existing','manual','flow','backfill')),
 first_inbound_at timestamptz,
 last_inbound_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,wa_id),
 FOREIGN KEY(organization_id,record_id) REFERENCES crm_records(organization_id,id)
);
CREATE INDEX crm_whatsapp_identities_record_idx
 ON crm_whatsapp_identities(organization_id,record_id);

CREATE OR REPLACE FUNCTION crm_cleanup_whatsapp_identity_on_record_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
 DELETE FROM crm_whatsapp_identities
 WHERE organization_id=NEW.organization_id AND record_id=NEW.id;
 RETURN NEW;
END $$;

CREATE TRIGGER crm_records_cleanup_whatsapp_identity
AFTER UPDATE OF deleted_at ON crm_records
FOR EACH ROW
WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
EXECUTE FUNCTION crm_cleanup_whatsapp_identity_on_record_delete();

ALTER TABLE crm_contact_preferences
 ADD COLUMN whatsapp_service_started_at timestamptz,
 ADD COLUMN whatsapp_last_inbound_at timestamptz,
 ADD COLUMN whatsapp_service_source text NOT NULL DEFAULT '' CHECK(length(whatsapp_service_source)<=80);

DO $$
DECLARE
 conversation_row record;
 candidate_ids uuid[];
 chosen_record uuid;
 created_record uuid;
 integration_actor uuid;
 safe_name text;
BEGIN
 FOR conversation_row IN
  SELECT c.*
  FROM whatsapp_conversations c
  WHERE c.last_inbound_at IS NOT NULL
  ORDER BY c.organization_id,c.created_at,c.id
  FOR UPDATE
 LOOP
  chosen_record := NULL;
  created_record := NULL;
  integration_actor := NULL;
  candidate_ids := ARRAY[]::uuid[];

  SELECT i.updated_by INTO integration_actor
  FROM whatsapp_integrations i
  WHERE i.organization_id=conversation_row.organization_id;

  IF conversation_row.record_id IS NOT NULL AND EXISTS(
   SELECT 1 FROM crm_records r
   WHERE r.organization_id=conversation_row.organization_id
     AND r.id=conversation_row.record_id
     AND r.deleted_at IS NULL
  ) THEN
   chosen_record := conversation_row.record_id;
  ELSE
   SELECT COALESCE(array_agg(DISTINCT match.record_id ORDER BY match.record_id),ARRAY[]::uuid[])
   INTO candidate_ids
   FROM (
    SELECT r.id record_id
    FROM crm_records r
    WHERE r.organization_id=conversation_row.organization_id
      AND r.deleted_at IS NULL
      AND conversation_row.external_wa_id IN (crm_normalize_whatsapp_number(r.phone),crm_normalize_whatsapp_number(r.whatsapp))
    UNION
    SELECT rc.record_id
    FROM crm_record_contacts rc
    JOIN crm_contacts contact ON contact.organization_id=rc.organization_id AND contact.id=rc.contact_id
    JOIN crm_records r ON r.organization_id=rc.organization_id AND r.id=rc.record_id AND r.deleted_at IS NULL
    WHERE rc.organization_id=conversation_row.organization_id
      AND conversation_row.external_wa_id IN (crm_normalize_whatsapp_number(contact.phone),crm_normalize_whatsapp_number(contact.whatsapp))
   ) match;

   IF cardinality(candidate_ids)=1 THEN
    chosen_record := candidate_ids[1];
   ELSIF cardinality(candidate_ids)>1 THEN
    UPDATE whatsapp_conversations
    SET record_id=NULL,link_status='ambiguous',link_source='none',version=version+1,updated_at=now()
    WHERE organization_id=conversation_row.organization_id AND id=conversation_row.id;
   ELSE
    safe_name := CASE WHEN length(trim(conversation_row.profile_name))>=2 THEN trim(conversation_row.profile_name) ELSE 'Contato WhatsApp' END;
    INSERT INTO crm_records(organization_id,kind,owner_id,name,phone,whatsapp,source,stage)
    VALUES (conversation_row.organization_id,'lead',NULL,safe_name,conversation_row.external_wa_id,conversation_row.external_wa_id,'WhatsApp','new')
    RETURNING id INTO created_record;
    chosen_record := created_record;
   END IF;
  END IF;

  IF chosen_record IS NOT NULL THEN
   UPDATE whatsapp_conversations
   SET record_id=chosen_record,link_status='identified',link_source=CASE WHEN link_source='manual' THEN 'manual' ELSE 'automatic' END,version=version+1,updated_at=now()
   WHERE organization_id=conversation_row.organization_id AND id=conversation_row.id
     AND record_id IS DISTINCT FROM chosen_record;

   INSERT INTO crm_whatsapp_identities(organization_id,wa_id,phone_e164,record_id,profile_name,source,first_inbound_at,last_inbound_at)
   VALUES (conversation_row.organization_id,conversation_row.external_wa_id,conversation_row.phone_e164,chosen_record,conversation_row.profile_name,'backfill',conversation_row.last_inbound_at,conversation_row.last_inbound_at)
   ON CONFLICT(organization_id,wa_id) DO UPDATE
   SET phone_e164=EXCLUDED.phone_e164,
       profile_name=CASE WHEN EXCLUDED.profile_name<>'' THEN EXCLUDED.profile_name ELSE crm_whatsapp_identities.profile_name END,
       first_inbound_at=LEAST(COALESCE(crm_whatsapp_identities.first_inbound_at,EXCLUDED.first_inbound_at),EXCLUDED.first_inbound_at),
       last_inbound_at=GREATEST(COALESCE(crm_whatsapp_identities.last_inbound_at,EXCLUDED.last_inbound_at),EXCLUDED.last_inbound_at),
       updated_at=now()
   WHERE crm_whatsapp_identities.record_id=EXCLUDED.record_id;

   IF integration_actor IS NOT NULL THEN
    INSERT INTO crm_contact_preferences(organization_id,record_id,whatsapp_consent_status,consent_source,updated_by,whatsapp_service_started_at,whatsapp_last_inbound_at,whatsapp_service_source)
    VALUES (conversation_row.organization_id,chosen_record,'unknown','',integration_actor,conversation_row.last_inbound_at,conversation_row.last_inbound_at,'client_initiated')
    ON CONFLICT(organization_id,record_id) DO UPDATE
    SET whatsapp_service_started_at=LEAST(COALESCE(crm_contact_preferences.whatsapp_service_started_at,EXCLUDED.whatsapp_service_started_at),EXCLUDED.whatsapp_service_started_at),
        whatsapp_last_inbound_at=GREATEST(COALESCE(crm_contact_preferences.whatsapp_last_inbound_at,EXCLUDED.whatsapp_last_inbound_at),EXCLUDED.whatsapp_last_inbound_at),
        whatsapp_service_source='client_initiated',updated_at=now();

    IF created_record IS NOT NULL THEN
     INSERT INTO crm_activities(organization_id,record_id,actor_id,action,detail)
     VALUES (conversation_row.organization_id,created_record,integration_actor,'whatsapp.lead.backfilled','Lead criado a partir de conversa inbound preexistente.');
     INSERT INTO audit_logs(organization_id,actor_id,action,detail)
     VALUES (conversation_row.organization_id,integration_actor,'whatsapp.lead.backfilled','Cadastro e conversa vinculados pelo backfill seguro do WhatsApp.');
    END IF;
   END IF;
  END IF;
 END LOOP;
END $$;

ALTER TABLE crm_whatsapp_identities ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE crm_whatsapp_identities FROM PUBLIC;
DO $$ DECLARE api_role text; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE crm_whatsapp_identities FROM %I',api_role);
  END IF;
 END LOOP;
END $$;
