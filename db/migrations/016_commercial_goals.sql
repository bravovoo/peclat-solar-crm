CREATE TABLE commercial_goals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 target_kind text NOT NULL CHECK(target_kind IN ('seller','team')),
 seller_user_id uuid,
 team_id uuid,
 metric text NOT NULL CHECK(metric IN ('sales_value','contracts_closed','opportunities_won','new_customers')),
 period text NOT NULL CHECK(period IN ('monthly','quarterly','annual')),
 starts_on date NOT NULL,
 ends_on date NOT NULL,
 target_value numeric(14,2) NOT NULL CHECK(target_value>0),
 created_by uuid NOT NULL,
 updated_by uuid NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,seller_user_id) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,team_id) REFERENCES commercial_teams(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,updated_by) REFERENCES memberships(organization_id,user_id),
 CHECK(ends_on>=starts_on),
 CHECK((target_kind='seller' AND seller_user_id IS NOT NULL AND team_id IS NULL) OR
       (target_kind='team' AND team_id IS NOT NULL AND seller_user_id IS NULL)),
 UNIQUE NULLS NOT DISTINCT(organization_id,target_kind,seller_user_id,team_id,metric,starts_on,ends_on)
);
CREATE INDEX commercial_goals_period_idx ON commercial_goals(organization_id,starts_on,ends_on);
CREATE INDEX commercial_goals_seller_idx ON commercial_goals(organization_id,seller_user_id,starts_on DESC) WHERE seller_user_id IS NOT NULL;
CREATE INDEX commercial_goals_team_idx ON commercial_goals(organization_id,team_id,starts_on DESC) WHERE team_id IS NOT NULL;

CREATE TABLE commercial_goal_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 goal_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('created','updated')),
 previous_value numeric(14,2),
 new_value numeric(14,2) NOT NULL,
 snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,goal_id) REFERENCES commercial_goals(organization_id,id),
 FOREIGN KEY(organization_id,actor_id) REFERENCES memberships(organization_id,user_id)
);
CREATE INDEX commercial_goal_history_idx ON commercial_goal_history(organization_id,goal_id,created_at DESC,id DESC);

INSERT INTO permissions(code,description) VALUES
 ('commercial_goals.read','Visualizar metas e desempenho comercial'),
 ('commercial_goals.manage','Gerenciar metas comerciais')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_code,permission_code)
SELECT r.code,p.code FROM roles r CROSS JOIN permissions p WHERE
 (r.code IN ('admin','manager') AND p.code IN ('commercial_goals.read','commercial_goals.manage')) OR
 (r.code='seller' AND p.code='commercial_goals.read')
ON CONFLICT DO NOTHING;

ALTER TABLE commercial_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial_goal_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE commercial_goals,commercial_goal_history FROM PUBLIC;
DO $$ DECLARE api_role text; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE commercial_goals,commercial_goal_history FROM %I',api_role);
  END IF;
 END LOOP;
END $$;
