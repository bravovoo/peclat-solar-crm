import type { PoolClient } from 'pg';
import { AccessError, type Actor } from '@/modules/auth/policy';

type Db = Pick<PoolClient, 'query'>;

export function commercialScopeParams(actor: Actor): unknown[] {
  return actor.role === 'admin' ? [actor.organizationId] : [actor.organizationId, actor.userId];
}

export function commercialScope(actor: Actor, alias: string, includeUnassignedLeads = false): string {
  const organization = `${alias}.organization_id=$1`;
  if (actor.role === 'admin') return organization;
  if (actor.role !== 'manager') return `${organization} AND ${alias}.owner_id=$2`;
  const team = `EXISTS (SELECT 1 FROM commercial_team_members tm
    JOIN commercial_teams ct ON ct.organization_id=tm.organization_id AND ct.id=tm.team_id
    JOIN memberships member ON member.organization_id=tm.organization_id AND member.user_id=tm.user_id
    WHERE tm.organization_id=$1 AND tm.user_id=${alias}.owner_id AND ct.manager_user_id=$2 AND ct.active)`;
  return `${organization} AND (${alias}.owner_id=$2 OR ${team}${includeUnassignedLeads ? ` OR (${alias}.kind='lead' AND ${alias}.owner_id IS NULL)` : ''})`;
}

export async function assertCommercialAssignee(actor: Actor, userId: string, db: Db, sellerOnly = false) {
  if (actor.role === 'seller' && userId !== actor.userId) throw new AccessError(403, 'Você só pode atribuir a si mesmo.');
  const result = await db.query<{role_code:string}>(`SELECT m.role_code FROM memberships m JOIN users u ON u.id=m.user_id
    WHERE m.organization_id=$1 AND m.user_id=$2 AND m.active AND u.active
      AND EXISTS(SELECT 1 FROM role_permissions rp WHERE rp.role_code=m.role_code AND rp.permission_code IN ('crm.all','crm.own'))`,
    [actor.organizationId, userId]);
  if (!result.rowCount || (sellerOnly && result.rows[0].role_code !== 'seller')) throw new AccessError(400, 'Responsável comercial inválido.');
  if (actor.role === 'manager' && userId !== actor.userId) {
    const team = await db.query(`SELECT 1 FROM commercial_team_members tm JOIN commercial_teams t
      ON t.organization_id=tm.organization_id AND t.id=tm.team_id
      WHERE tm.organization_id=$1 AND tm.user_id=$2 AND t.manager_user_id=$3 AND t.active`,
      [actor.organizationId,userId,actor.userId]);
    if (!team.rowCount) throw new AccessError(403, 'Vendedor fora de sua equipe.');
  }
}

export async function assertManagedTeam(actor: Actor, teamId: string, db: Db, lock = false) {
  if (!actor.permissions.includes('commercial_team.manage')) throw new AccessError(403, 'Acesso restrito à gestão comercial.');
  const team = await db.query<{id:string;active:boolean;auto_distribute:boolean;distribution_cursor:string}>(
    `SELECT id,active,auto_distribute,distribution_cursor FROM commercial_teams
     WHERE organization_id=$1 AND id=$2 AND ($3::boolean OR manager_user_id=$4)${lock ? ' FOR UPDATE' : ''}`,
    [actor.organizationId,teamId,actor.role==='admin',actor.userId]);
  if (!team.rowCount) throw new AccessError(404, 'Equipe não encontrada.');
  return team.rows[0];
}
