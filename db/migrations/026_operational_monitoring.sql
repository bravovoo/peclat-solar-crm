CREATE TABLE operational_monitor_status (
 organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'healthy' CHECK(status IN ('healthy','degraded')),
 open_alerts integer NOT NULL DEFAULT 0 CHECK(open_alerts>=0),
 last_checked_at timestamptz NOT NULL DEFAULT now(),
 last_healthy_at timestamptz,
 check_duration_ms integer NOT NULL DEFAULT 0 CHECK(check_duration_ms>=0),
 updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE operational_alerts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 code text NOT NULL CHECK(code ~ '^[a-z0-9_]{3,80}$'),
 severity text NOT NULL CHECK(severity IN ('warning','critical')),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','resolved')),
 title text NOT NULL CHECK(length(title) BETWEEN 3 AND 180),
 detail text NOT NULL CHECK(length(detail) BETWEEN 3 AND 500),
 occurrence_count integer NOT NULL DEFAULT 1 CHECK(occurrence_count>0),
 first_detected_at timestamptz NOT NULL DEFAULT now(),
 last_detected_at timestamptz NOT NULL DEFAULT now(),
 acknowledged_by uuid,
 acknowledged_at timestamptz,
 resolved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,acknowledged_by) REFERENCES memberships(organization_id,user_id)
);
CREATE UNIQUE INDEX operational_alerts_active_uidx ON operational_alerts(organization_id,code) WHERE status IN ('open','acknowledged');
CREATE INDEX operational_alerts_org_idx ON operational_alerts(organization_id,status,severity,last_detected_at DESC);

INSERT INTO permissions(code,description) VALUES
 ('operations.read','Visualizar saúde operacional e alertas'),
 ('operations.manage','Reconhecer alertas operacionais')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_code,permission_code)
SELECT r.code,p.code FROM roles r CROSS JOIN permissions p
WHERE r.code='admin' AND p.code IN ('operations.read','operations.manage')
ON CONFLICT DO NOTHING;

ALTER TABLE operational_monitor_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE operational_monitor_status,operational_alerts FROM PUBLIC;
DO $$ DECLARE api_role text; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE operational_monitor_status,operational_alerts FROM %I',api_role);
  END IF;
 END LOOP;
END $$;
