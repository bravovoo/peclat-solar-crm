CREATE TABLE commercial_teams (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 name text NOT NULL CHECK(length(name) BETWEEN 2 AND 120),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=1000),
 manager_user_id uuid NOT NULL,
 active boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by uuid NOT NULL,
 updated_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,manager_user_id) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,created_by) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,updated_by) REFERENCES memberships(organization_id,user_id)
);
CREATE UNIQUE INDEX commercial_teams_name_idx ON commercial_teams(organization_id,lower(name));
CREATE INDEX commercial_teams_manager_idx ON commercial_teams(organization_id,manager_user_id,active);

-- Um vendedor tem uma única equipe comercial por organização. A associação
-- pode ser removida antes de transferi-lo, sem alterar seu membership/login.
CREATE TABLE commercial_team_members (
 organization_id uuid NOT NULL,
 team_id uuid NOT NULL,
 user_id uuid NOT NULL,
 added_by uuid NOT NULL,
 added_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,user_id),
 FOREIGN KEY(organization_id,team_id) REFERENCES commercial_teams(organization_id,id),
 FOREIGN KEY(organization_id,user_id) REFERENCES memberships(organization_id,user_id),
 FOREIGN KEY(organization_id,added_by) REFERENCES memberships(organization_id,user_id)
);
CREATE INDEX commercial_team_members_team_idx ON commercial_team_members(organization_id,team_id);

CREATE TABLE commercial_team_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 team_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 action text NOT NULL CHECK(length(action) BETWEEN 2 AND 80),
 detail text NOT NULL DEFAULT '' CHECK(length(detail)<=500),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,team_id) REFERENCES commercial_teams(organization_id,id),
 FOREIGN KEY(organization_id,actor_id) REFERENCES memberships(organization_id,user_id)
);
CREATE INDEX commercial_team_history_idx ON commercial_team_history(organization_id,team_id,created_at DESC,id DESC);

INSERT INTO permissions(code,description) VALUES
 ('commercial_team.read','Visualizar a estrutura comercial autorizada'),
 ('commercial_team.manage','Gerenciar equipes comerciais')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_code,permission_code)
SELECT r.code,p.code FROM roles r CROSS JOIN permissions p WHERE
 (r.code IN ('admin','manager') AND p.code IN ('commercial_team.read','commercial_team.manage')) OR
 (r.code='seller' AND p.code='commercial_team.read')
ON CONFLICT DO NOTHING;

ALTER TABLE commercial_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE commercial_team_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE commercial_teams,commercial_team_members,commercial_team_history FROM PUBLIC;
DO $$ DECLARE api_role text; BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE commercial_teams,commercial_team_members,commercial_team_history FROM %I',api_role);
  END IF;
 END LOOP;
END $$;
