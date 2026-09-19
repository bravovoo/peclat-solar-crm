import { z } from 'zod';
import { transaction } from '@/server/db';
import { AccessError, type Actor } from '@/modules/auth/policy';
import { uuid } from '@/modules/crm/domain';
import { assertCommercialAssignee, assertManagedTeam, commercialScope, commercialScopeParams } from './scope';

const selections = z.array(z.object({id:uuid,version:z.number().int().positive()}).strict()).min(1).max(100)
  .refine(items => new Set(items.map(item => item.id)).size === items.length, 'Leads repetidos.');
const request = z.discriminatedUnion('mode', [
  z.object({mode:z.literal('manual'),leads:selections,owner_id:uuid}).strict(),
  z.object({mode:z.literal('automatic'),leads:selections,team_id:uuid}).strict(),
]);

export async function distributeLeads(actor: Actor, input: unknown) {
  if (!actor.permissions.includes('commercial_team.manage')) throw new AccessError(403,'Distribuição restrita à gestão comercial.');
  const data = request.parse(input);
  return transaction(async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[actor.organizationId]);
    let sellers: {id:string;name:string}[] = [];
    let cursor = 0;
    if (data.mode === 'manual') {
      await assertCommercialAssignee(actor,data.owner_id,db,true);
      const user = await db.query<{id:string;name:string}>('SELECT id,name FROM users WHERE id=$1',[data.owner_id]);
      sellers = user.rows;
    } else {
      const team = await assertManagedTeam(actor,data.team_id,db,true);
      if (!team.active || !team.auto_distribute) throw new AccessError(409,'Ative a distribuição automática desta equipe.');
      const members = await db.query<{id:string;name:string}>(`SELECT u.id,u.name FROM commercial_team_members tm
        JOIN memberships m ON m.organization_id=tm.organization_id AND m.user_id=tm.user_id
        JOIN users u ON u.id=m.user_id WHERE tm.organization_id=$1 AND tm.team_id=$2
        AND m.role_code='seller' AND m.active AND u.active ORDER BY tm.added_at,tm.user_id`,
        [actor.organizationId,data.team_id]);
      sellers=members.rows;
      if (!sellers.length) throw new AccessError(409,'A equipe não possui vendedores ativos.');
      cursor=Number(team.distribution_cursor);
    }
    const scoped = commercialScope(actor,'r',true);
    const args = commercialScopeParams(actor);
    args.push(data.leads.map(item => item.id));
    const rows = await db.query<{id:string;owner_id:string|null;owner_name:string|null;version:number}>(`SELECT r.id,r.owner_id,u.name owner_name,r.version FROM crm_records r
      LEFT JOIN users u ON u.id=r.owner_id
      WHERE ${scoped} AND r.kind='lead' AND r.status='active' AND r.deleted_at IS NULL
        AND r.id=ANY($${args.length}::uuid[]) ORDER BY r.id FOR UPDATE OF r`,args);
    if (rows.rowCount !== data.leads.length) throw new AccessError(409,'Um dos leads não está disponível. Atualize a lista.');
    const requested = new Map(data.leads.map(item => [item.id,item.version]));
    for (const row of rows.rows) {
      if (row.version !== requested.get(row.id)) throw new AccessError(409,'Um lead foi alterado. Atualize a lista.');
      if (data.mode === 'automatic' && row.owner_id) throw new AccessError(409,'A distribuição automática aceita somente leads sem responsável.');
    }
    let index=0;
    for(const row of rows.rows){
      const seller=sellers[(cursor+index)%sellers.length];
      await db.query('UPDATE crm_records SET owner_id=$3,version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2',
        [actor.organizationId,row.id,seller.id]);
      await db.query(`INSERT INTO crm_activities(organization_id,record_id,actor_id,action,detail)
        VALUES ($1,$2,$3,$4,$5)`, [actor.organizationId,row.id,actor.userId,
          data.mode==='automatic'?'lead.distributed_auto':'lead.distributed_manual',`${row.owner_name??'Sem responsável'} -> ${seller.name}`]);
      index++;
    }
    if (data.mode === 'automatic') {
      await db.query('UPDATE commercial_teams SET distribution_cursor=distribution_cursor+$3,updated_by=$4,updated_at=now() WHERE organization_id=$1 AND id=$2',
        [actor.organizationId,data.team_id,index,actor.userId]);
    }
    await db.query('INSERT INTO audit_logs(organization_id,actor_id,action) VALUES ($1,$2,$3)',
      [actor.organizationId,actor.userId,data.mode==='automatic'?'commercial.leads.round_robin':'commercial.leads.assigned']);
    return {assigned:index};
  });
}

export async function setTeamDistribution(actor: Actor, teamId: string, input: unknown) {
  const data = z.object({enabled:z.boolean(),version:z.number().int().positive()}).strict().parse(input);
  return transaction(async db => {
    const team = await assertManagedTeam(actor,uuid.parse(teamId),db,true);
    const updated = await db.query<{version:number}>(`UPDATE commercial_teams SET auto_distribute=$3,version=version+1,
      updated_by=$4,updated_at=now() WHERE organization_id=$1 AND id=$2 AND version=$5 RETURNING version`,
      [actor.organizationId,teamId,data.enabled,actor.userId,data.version]);
    if (!updated.rowCount) throw new AccessError(409,'Equipe atualizada por outra pessoa. Recarregue.');
    if (team.auto_distribute !== data.enabled) {
      await db.query(`INSERT INTO commercial_team_history(organization_id,team_id,actor_id,action,detail)
        VALUES ($1,$2,$3,'distribution_changed',$4)`, [actor.organizationId,teamId,actor.userId,data.enabled?'Ativada':'Desativada']);
      await db.query("INSERT INTO audit_logs(organization_id,actor_id,action) VALUES ($1,$2,'commercial_team.distribution_changed')",
        [actor.organizationId,actor.userId]);
    }
    return {version:updated.rows[0].version,auto_distribute:data.enabled};
  });
}

export async function transferPortfolio(actor: Actor, input: unknown) {
  if (!actor.permissions.includes('commercial_team.manage')) throw new AccessError(403,'Transferência restrita à gestão comercial.');
  const data = z.object({from_user_id:uuid,to_user_id:uuid,confirm:z.literal(true)}).strict().parse(input);
  if (data.from_user_id === data.to_user_id) throw new AccessError(400,'Selecione vendedores diferentes.');
  return transaction(async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[actor.organizationId]);
    const source = await db.query<{name:string}>(`SELECT u.name FROM memberships m JOIN users u ON u.id=m.user_id
      WHERE m.organization_id=$1 AND m.user_id=$2 AND m.role_code='seller'`,[actor.organizationId,data.from_user_id]);
    if (!source.rowCount) throw new AccessError(400,'Vendedor de origem inválido.');
    if (actor.role === 'manager') {
      const allowed = await db.query(`SELECT 1 FROM commercial_team_members tm JOIN commercial_teams t
        ON t.organization_id=tm.organization_id AND t.id=tm.team_id
        WHERE tm.organization_id=$1 AND tm.user_id=$2 AND t.manager_user_id=$3 AND t.active`,
        [actor.organizationId,data.from_user_id,actor.userId]);
      if (!allowed.rowCount) throw new AccessError(403,'Vendedor de origem fora de sua equipe.');
    }
    await assertCommercialAssignee(actor,data.to_user_id,db,true);
    const target = await db.query<{name:string}>('SELECT name FROM users WHERE id=$1',[data.to_user_id]);
    const detail = `${source.rows[0].name} -> ${target.rows[0].name}`;
    const records = await db.query<{id:string}>(`UPDATE crm_records SET owner_id=$3,version=version+1,updated_at=now()
      WHERE organization_id=$1 AND owner_id=$2 AND deleted_at IS NULL RETURNING id`,
      [actor.organizationId,data.from_user_id,data.to_user_id]);
    // saveTask bloqueia a tarefa antes de atualizar a oportunidade no histórico.
    // Preservar essa ordem evita espera circular durante a transferência.
    const tasks = await db.query<{id:string}>(`UPDATE crm_tasks SET owner_id=$3,version=version+1,updated_at=now()
      WHERE organization_id=$1 AND owner_id=$2 RETURNING id`,
      [actor.organizationId,data.from_user_id,data.to_user_id]);
    const opportunities = await db.query<{id:string}>(`UPDATE crm_opportunities SET owner_id=$3,version=version+1,updated_at=now()
      WHERE organization_id=$1 AND owner_id=$2 RETURNING id`,
      [actor.organizationId,data.from_user_id,data.to_user_id]);
    await db.query(`INSERT INTO crm_activities(organization_id,record_id,actor_id,action,detail)
      SELECT $1,item.id,$2,'portfolio.transferred',$3 FROM unnest($4::uuid[]) AS item(id)`,
      [actor.organizationId,actor.userId,detail,records.rows.map(row=>row.id)]);
    await db.query(`INSERT INTO crm_activities(organization_id,opportunity_id,actor_id,action,detail)
      SELECT $1,item.id,$2,'portfolio.transferred',$3 FROM unnest($4::uuid[]) AS item(id)`,
      [actor.organizationId,actor.userId,detail,opportunities.rows.map(row=>row.id)]);
    await db.query("INSERT INTO audit_logs(organization_id,actor_id,action) VALUES ($1,$2,'commercial.portfolio.transferred')",
      [actor.organizationId,actor.userId]);
    return {records:records.rowCount,opportunities:opportunities.rowCount,tasks:tasks.rowCount};
  });
}
