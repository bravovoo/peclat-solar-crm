CREATE TABLE organization_operational_notification_settings (
 organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
 email_enabled boolean NOT NULL DEFAULT false,
 recipients text[] NOT NULL DEFAULT '{}',
 minimum_severity text NOT NULL DEFAULT 'critical' CHECK(minimum_severity IN ('warning','critical')),
 notify_recovery boolean NOT NULL DEFAULT true,
 critical_escalation_minutes integer NOT NULL DEFAULT 60 CHECK(critical_escalation_minutes BETWEEN 15 AND 1440),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 updated_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(cardinality(recipients)<=5),
 FOREIGN KEY(organization_id,updated_by) REFERENCES memberships(organization_id,user_id)
);

CREATE TABLE operational_alert_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 alert_id uuid NOT NULL,
 notification_kind text NOT NULL CHECK(notification_kind IN ('opened','escalated','resolved')),
 channel text NOT NULL DEFAULT 'email' CHECK(channel='email'),
 recipient text NOT NULL CHECK(length(recipient) BETWEEN 3 AND 254),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','sent','failed','uncertain')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 scheduled_for timestamptz NOT NULL DEFAULT now(),
 locked_at timestamptz,
 sent_at timestamptz,
 provider_message_id text NOT NULL DEFAULT '',
 safe_error text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,alert_id) REFERENCES operational_alerts(organization_id,id) ON DELETE CASCADE,
 UNIQUE(organization_id,alert_id,notification_kind,recipient)
);
CREATE INDEX operational_alert_deliveries_queue_idx ON operational_alert_deliveries(status,scheduled_for,created_at);
CREATE INDEX operational_alert_deliveries_org_idx ON operational_alert_deliveries(organization_id,created_at DESC);

ALTER TABLE organization_operational_notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_alert_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE organization_operational_notification_settings,operational_alert_deliveries FROM PUBLIC;
DO $$ DECLARE api_role text; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE organization_operational_notification_settings,operational_alert_deliveries FROM %I',api_role);
  END IF;
 END LOOP;
END $$;
