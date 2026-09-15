import { database } from '../../server/db';
import { requirePermission, type Actor } from '../auth/policy';
export async function teamMembers(actor: Actor) {
  requirePermission(actor, 'team.read');
  const { rows } = await database().query<{ id: string; name: string; email: string; role: string; active: boolean }>(`
    SELECT u.id,u.name,u.email,r.name AS role,(u.active AND m.active) AS active FROM memberships m
    JOIN users u ON u.id=m.user_id JOIN roles r ON r.code=m.role_code
    WHERE m.organization_id=$1 ORDER BY u.name LIMIT 100`, [actor.organizationId]);
  return rows;
}
export async function recentAudit(actor: Actor) {
  requirePermission(actor, 'audit.read');
  const { rows } = await database().query<{id: string; action: string; created_at: Date; name: string | null}>(`
    SELECT a.id,a.action,a.created_at,u.name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id
    WHERE a.organization_id=$1 ORDER BY a.created_at DESC LIMIT 8`, [actor.organizationId]);
  return rows;
}
