import { database, transaction } from '../../server/db';
import { dummyHash, hashPassword, newToken, tokenHash, verifyPassword } from './crypto';
import { AccessError, type Actor } from './policy';
import { loginSchema, recoverySchema, resetSchema } from './validation';
import type { MailProvider } from '../../integrations/mail';

export async function consumeRateLimit(key: string, limit: number, seconds: number) {
  const { rows } = await database().query<{ attempts: number }>(`
    INSERT INTO rate_limits(key_hash, attempts, expires_at) VALUES ($1, 1, now() + $2 * interval '1 second')
    ON CONFLICT(key_hash) DO UPDATE SET
      attempts = CASE WHEN rate_limits.expires_at <= now() THEN 1 ELSE rate_limits.attempts + 1 END,
      expires_at = CASE WHEN rate_limits.expires_at <= now() THEN EXCLUDED.expires_at ELSE rate_limits.expires_at END
    RETURNING attempts`, [tokenHash(key), seconds]);
  if (rows[0].attempts > limit) throw new AccessError(429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
}

export async function login(input: unknown) {
  const data = loginSchema.parse(input);
  await consumeRateLimit('login:global', 300, 60);
  await consumeRateLimit(`login:${data.organization}:${data.email}`, 10, 900);
  const result = await database().query<{ id: string; organization_id: string; password_hash: string }>(`
    SELECT u.id, m.organization_id, u.password_hash FROM users u
    JOIN memberships m ON m.user_id = u.id JOIN organizations o ON o.id = m.organization_id
    WHERE u.email = $1 AND o.slug = $2 AND u.active AND m.active`, [data.email, data.organization]);
  const user = result.rows[0];
  const valid = await verifyPassword(data.password, user?.password_hash ?? dummyHash);
  if (!user || !valid) throw new AccessError(401, 'Organização, e-mail ou senha inválidos.');
  const token = newToken();
  await transaction(async client => {
    const current = await client.query('SELECT id FROM users WHERE id=$1 AND password_hash=$2 AND active FOR UPDATE', [user.id, user.password_hash]);
    if (!current.rowCount) throw new AccessError(401, 'Acesso alterado. Entre novamente.');
    const membership = await client.query('SELECT user_id FROM memberships WHERE user_id=$1 AND organization_id=$2 AND active FOR UPDATE', [user.id, user.organization_id]);
    if (!membership.rowCount) throw new AccessError(401, 'Acesso alterado. Entre novamente.');
    await client.query("INSERT INTO sessions(token_hash, user_id, organization_id, expires_at) VALUES ($1,$2,$3,now()+interval '8 hours')", [tokenHash(token), user.id, user.organization_id]);
    await client.query("INSERT INTO audit_logs(organization_id,actor_id,action) VALUES ($1,$2,'auth.login')", [user.organization_id, user.id]);
  });
  return token;
}

export async function sessionActor(token?: string): Promise<Actor | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const { rows } = await database().query<Actor>(`
    SELECT u.id AS "userId", o.id AS "organizationId", u.name, u.email,
      o.name AS "organizationName", o.slug AS "organizationSlug", r.code AS role, r.name AS "roleName",
      COALESCE(array_agg(rp.permission_code) FILTER (WHERE rp.permission_code IS NOT NULL), '{}') AS permissions
    FROM sessions s JOIN users u ON u.id=s.user_id
    JOIN memberships m ON m.user_id=s.user_id AND m.organization_id=s.organization_id
    JOIN organizations o ON o.id=m.organization_id JOIN roles r ON r.code=m.role_code
    LEFT JOIN role_permissions rp ON rp.role_code=r.code
    WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active AND m.active
    GROUP BY u.id,o.id,r.code`, [tokenHash(token)]);
  return rows[0] ?? null;
}

export async function logout(token?: string) {
  if (!token) return;
  await transaction(async client => {
    const result = await client.query('DELETE FROM sessions WHERE token_hash=$1 RETURNING organization_id,user_id', [tokenHash(token)]);
    const row = result.rows[0];
    if (row) await client.query("INSERT INTO audit_logs(organization_id,actor_id,action) VALUES ($1,$2,'auth.logout')", [row.organization_id, row.user_id]);
  });
}

export async function requestRecovery(input: unknown, mail: MailProvider, appUrl: string) {
  const data = recoverySchema.parse(input);
  await consumeRateLimit('recovery:global', 60, 60);
  await consumeRateLimit(`recovery:${data.organization}:${data.email}`, 3, 900);
  const { rows } = await database().query(`SELECT u.id,u.email,m.organization_id FROM users u
    JOIN memberships m ON m.user_id=u.id JOIN organizations o ON o.id=m.organization_id
    WHERE u.email=$1 AND o.slug=$2 AND u.active AND m.active`, [data.email, data.organization]);
  const user = rows[0];
  if (!user) return;
  const token = newToken();
  await transaction(async client => {
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user.id]);
    await client.query('DELETE FROM password_resets WHERE user_id=$1', [user.id]);
    await client.query("INSERT INTO password_resets(token_hash,user_id,organization_id,expires_at) VALUES ($1,$2,$3,now()+interval '30 minutes')", [tokenHash(token), user.id, user.organization_id]);
  });
  try {
    await mail.sendRecovery(user.email, `${appUrl}/redefinir-senha#${token}`);
  } catch {
    await database().query('DELETE FROM password_resets WHERE token_hash=$1', [tokenHash(token)]);
    // Mesma resposta pública para contas existentes e inexistentes. Não registrar endereço/token.
    console.error('recovery_delivery_failed');
  }
}

export async function resetPassword(input: unknown) {
  const data = resetSchema.parse(input);
  await consumeRateLimit('reset:global', 100, 60);
  const hash = tokenHash(data.token);
  const result = await database().query('SELECT user_id FROM password_resets WHERE token_hash=$1 AND expires_at>now()', [hash]);
  if (!result.rowCount) throw new AccessError(400, 'Link inválido ou expirado. Solicite um novo.');
  const password = await hashPassword(data.password);
  await transaction(async client => {
    await client.query('SELECT id FROM users WHERE id=$1 AND active FOR UPDATE', [result.rows[0].user_id]);
    const consumed = await client.query(`DELETE FROM password_resets p USING users u,memberships m
      WHERE p.token_hash=$1 AND p.expires_at>now() AND u.id=p.user_id AND u.active
      AND m.user_id=p.user_id AND m.organization_id=p.organization_id AND m.active
      RETURNING p.user_id,p.organization_id`, [hash]);
    const row = consumed.rows[0];
    if (!row) throw new AccessError(400, 'Link inválido ou expirado. Solicite um novo.');
    await client.query('UPDATE users SET password_hash=$1 WHERE id=$2', [password, row.user_id]);
    await client.query('DELETE FROM sessions WHERE user_id=$1', [row.user_id]);
    await client.query('DELETE FROM password_resets WHERE user_id=$1', [row.user_id]);
    await client.query("INSERT INTO audit_logs(organization_id,actor_id,action) VALUES ($1,$2,'auth.password_reset')", [row.organization_id, row.user_id]);
  });
}
