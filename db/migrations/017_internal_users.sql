ALTER TABLE audit_logs
 ADD COLUMN subject_user_id uuid,
 ADD COLUMN detail text NOT NULL DEFAULT '' CHECK(length(detail)<=500),
 ADD FOREIGN KEY(organization_id,subject_user_id) REFERENCES memberships(organization_id,user_id);
CREATE INDEX audit_logs_subject_idx ON audit_logs(organization_id,subject_user_id,created_at DESC) WHERE subject_user_id IS NOT NULL;

ALTER TABLE memberships
 ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);

INSERT INTO permissions(code,description) VALUES
 ('users.read','Visualizar usuários e acessos da organização'),
 ('users.manage','Gerenciar usuários e acessos da organização')
ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_code,permission_code)
SELECT roles.code,p.code FROM roles CROSS JOIN permissions p
WHERE roles.code='admin' AND p.code IN ('users.read','users.manage')
ON CONFLICT DO NOTHING;

-- audit_logs já possui RLS e revogações estabelecidas na migration 010.
