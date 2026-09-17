import { database, transaction } from '@/server/db';
import { AccessError, requirePermission, type Actor } from '@/modules/auth/policy';
import { commercialTeamInput, teamId, teamMemberInput, type CommercialTeam, type CommercialTeamMember } from './domain';

const canManage = (actor: Actor) => actor.permissions.includes('commercial_team.manage');
const normalizeTeam = (row: CommercialTeam) => ({ ...row, member_count: Number(row.member_count) });
const normalizeMember = (row: CommercialTeamMember) => ({ ...row, leads: Number(row.leads), customers: Number(row.customers), opportunities_open: Number(row.opportunities_open), tasks_open: Number(row.tasks_open) });

export async function commercialTeamOverview(actor: Actor) {
  requirePermission(actor, 'commercial_team.read');
  const manage = canManage(actor);
  const [teams, members, history] = await Promise.all([
    database().query<CommercialTeam>(`SELECT t.id,t.name,t.description,t.manager_user_id,u.name manager_name,t.active,t.version,t.created_at,t.updated_at,
      count(tm.user_id)::int member_count
      FROM commercial_teams t JOIN users u ON u.id=t.manager_user_id
      LEFT JOIN commercial_team_members tm ON tm.organization_id=t.organization_id AND tm.team_id=t.id
      WHERE t.organization_id=$1 AND ($2::boolean OR EXISTS (
        SELECT 1 FROM commercial_team_members own WHERE own.organization_id=t.organization_id AND own.team_id=t.id AND own.user_id=$3))
      GROUP BY t.id,u.name ORDER BY t.active DESC,t.name,t.id`, [actor.organizationId, manage, actor.userId]),
    database().query<CommercialTeamMember>(`SELECT u.id,u.name,u.email,m.role_code,r.name role_name,(u.active AND m.active) active,
      tm.team_id,t.name team_name,manager.name manager_name,
      COALESCE(rec.leads,0)::int leads,COALESCE(rec.customers,0)::int customers,
      COALESCE(opp.total,0)::int opportunities_open,COALESCE(tasks.total,0)::int tasks_open
      FROM memberships m JOIN users u ON u.id=m.user_id JOIN roles r ON r.code=m.role_code
      LEFT JOIN commercial_team_members tm ON tm.organization_id=m.organization_id AND tm.user_id=m.user_id
      LEFT JOIN commercial_teams t ON t.organization_id=tm.organization_id AND t.id=tm.team_id
      LEFT JOIN users manager ON manager.id=t.manager_user_id
      LEFT JOIN LATERAL (SELECT count(*) FILTER (WHERE kind='lead') leads,count(*) FILTER (WHERE kind='customer') customers
        FROM crm_records WHERE organization_id=m.organization_id AND owner_id=m.user_id AND deleted_at IS NULL) rec ON true
      LEFT JOIN LATERAL (SELECT count(*) total FROM crm_opportunities WHERE organization_id=m.organization_id AND owner_id=m.user_id AND status='open') opp ON true
      LEFT JOIN LATERAL (SELECT count(*) total FROM crm_tasks WHERE organization_id=m.organization_id AND owner_id=m.user_id AND status IN ('pending','in_progress')) tasks ON true
      WHERE m.organization_id=$1 AND m.role_code IN ('admin','manager','seller') AND ($2::boolean OR m.user_id=$3)
      ORDER BY CASE m.role_code WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END,u.name,u.id LIMIT 500`,
      [actor.organizationId, manage, actor.userId]),
    manage ? database().query<{id:string;team_id:string;actor_name:string;action:string;detail:string;created_at:string}>(
      `SELECT h.id,h.team_id,u.name actor_name,h.action,h.detail,h.created_at FROM commercial_team_history h
       JOIN users u ON u.id=h.actor_id WHERE h.organization_id=$1 ORDER BY h.created_at DESC,h.id DESC LIMIT 30`, [actor.organizationId])
      : Promise.resolve({rows: []}),
  ]);
  return { teams: teams.rows.map(normalizeTeam), members: members.rows.map(normalizeMember), history: history.rows, can_manage: manage };
}

async function logChange(db: Pick<ReturnType<typeof database>, 'query'>, actor: Actor, teamIdValue: string, action: string, detail: string) {
  await db.query('INSERT INTO commercial_team_history(organization_id,team_id,actor_id,action,detail) VALUES ($1,$2,$3,$4,$5)',
    [actor.organizationId, teamIdValue, actor.userId, action, detail]);
  await db.query('INSERT INTO audit_logs(organization_id,actor_id,action) VALUES ($1,$2,$3)',
    [actor.organizationId, actor.userId, `commercial_team.${action}`]);
}

export async function saveCommercialTeam(actor: Actor, input: unknown, id?: string) {
  requirePermission(actor, 'commercial_team.manage');
  if (id) teamId.parse(id);
  const data = commercialTeamInput.parse(input);
  return transaction(async db => {
    const manager = await db.query<{name:string}>(`SELECT u.name FROM memberships m JOIN users u ON u.id=m.user_id
      WHERE m.organization_id=$1 AND m.user_id=$2 AND m.role_code='manager' AND m.active AND u.active`,
      [actor.organizationId, data.manager_user_id]);
    if (!manager.rowCount) throw new AccessError(400, 'Selecione um gerente comercial ativo da organização.');
    const before = id ? await db.query<{name:string;manager_user_id:string;active:boolean;version:number}>(
      'SELECT name,manager_user_id,active,version FROM commercial_teams WHERE organization_id=$1 AND id=$2 FOR UPDATE', [actor.organizationId,id]) : null;
    if (id && !before?.rowCount) throw new AccessError(404, 'Equipe não encontrada.');
    if (id && before?.rows[0].version !== data.version) throw new AccessError(409, 'Equipe atualizada por outra pessoa. Recarregue.');
    try {
      const saved = id
        ? await db.query<{id:string}>(`UPDATE commercial_teams SET name=$3,description=$4,manager_user_id=$5,active=$6,
            version=version+1,updated_by=$7,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING id`,
            [actor.organizationId,id,data.name,data.description,data.manager_user_id,data.active,actor.userId])
        : await db.query<{id:string}>(`INSERT INTO commercial_teams(organization_id,name,description,manager_user_id,active,created_by,updated_by)
            VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id`,
            [actor.organizationId,data.name,data.description,data.manager_user_id,data.active,actor.userId]);
      const savedId = saved.rows[0].id;
      await logChange(db,actor,savedId,id?'updated':'created',data.name);
      if (before?.rows[0].manager_user_id !== undefined && before.rows[0].manager_user_id !== data.manager_user_id)
        await logChange(db,actor,savedId,'manager_changed',manager.rows[0].name);
      if (before?.rows[0].active !== undefined && before.rows[0].active !== data.active)
        await logChange(db,actor,savedId,data.active?'reactivated':'deactivated',data.name);
      return savedId;
    } catch (error) {
      if ((error as {code?:string}).code === '23505') throw new AccessError(409, 'Já existe uma equipe com esse nome nesta organização.');
      throw error;
    }
  });
}

export async function changeCommercialTeamMember(actor: Actor, teamIdValue: string, input: unknown) {
  requirePermission(actor, 'commercial_team.manage');
  teamId.parse(teamIdValue);
  const data = teamMemberInput.parse(input);
  return transaction(async db => {
    const team = await db.query<{active:boolean;name:string}>(
      'SELECT active,name FROM commercial_teams WHERE organization_id=$1 AND id=$2 FOR UPDATE', [actor.organizationId,teamIdValue]);
    if (!team.rowCount) throw new AccessError(404, 'Equipe não encontrada.');
    if (data.action === 'add') {
      if (!team.rows[0].active) throw new AccessError(409, 'Reative a equipe antes de adicionar vendedores.');
      const seller = await db.query<{name:string}>(`SELECT u.name FROM memberships m JOIN users u ON u.id=m.user_id
        WHERE m.organization_id=$1 AND m.user_id=$2 AND m.role_code='seller' AND m.active AND u.active`,
        [actor.organizationId,data.user_id]);
      if (!seller.rowCount) throw new AccessError(400, 'Selecione um vendedor ativo da organização.');
      const added = await db.query('INSERT INTO commercial_team_members(organization_id,team_id,user_id,added_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING user_id',
        [actor.organizationId,teamIdValue,data.user_id,actor.userId]);
      if (!added.rowCount) throw new AccessError(409, 'O vendedor já pertence a uma equipe comercial.');
      await logChange(db,actor,teamIdValue,'member_added',seller.rows[0].name);
    } else {
      const removed = await db.query<{name:string}>(`DELETE FROM commercial_team_members tm USING users u
        WHERE tm.organization_id=$1 AND tm.team_id=$2 AND tm.user_id=$3 AND u.id=tm.user_id RETURNING u.name`,
        [actor.organizationId,teamIdValue,data.user_id]);
      if (!removed.rowCount) throw new AccessError(404, 'Vendedor não pertence a esta equipe.');
      await logChange(db,actor,teamIdValue,'member_removed',removed.rows[0].name);
    }
    return {ok:true};
  });
}
