CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,64}$'),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  name text NOT NULL,
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE roles (code text PRIMARY KEY, name text NOT NULL);
CREATE TABLE permissions (code text PRIMARY KEY, description text NOT NULL);
CREATE TABLE role_permissions (
  role_code text NOT NULL REFERENCES roles(code),
  permission_code text NOT NULL REFERENCES permissions(code),
  PRIMARY KEY (role_code, permission_code)
);
CREATE TABLE memberships (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role_code text NOT NULL REFERENCES roles(code),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships(user_id);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, user_id) REFERENCES memberships(organization_id, user_id)
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE password_resets (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  organization_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (organization_id, user_id) REFERENCES memberships(organization_id, user_id)
);
CREATE INDEX password_resets_user_idx ON password_resets(user_id);
CREATE INDEX password_resets_expiry_idx ON password_resets(expires_at);
CREATE TABLE rate_limits (
  key_hash text PRIMARY KEY,
  attempts integer NOT NULL CHECK (attempts > 0),
  expires_at timestamptz NOT NULL
);
CREATE INDEX rate_limits_expiry_idx ON rate_limits(expires_at);
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  actor_id uuid,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, actor_id) REFERENCES memberships(organization_id, user_id)
);
CREATE INDEX audit_logs_org_date_idx ON audit_logs(organization_id, created_at DESC);
