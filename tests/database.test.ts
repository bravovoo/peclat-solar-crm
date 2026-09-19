import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import pg from 'pg';
import EmbeddedPostgres from '../scripts/embedded-db';
import { database, transaction } from '../src/server/db';
import { migrate } from '../scripts/migrate';
import { seed } from '../scripts/seed';
import { login, sessionActor, logout, requestRecovery, resetPassword, consumeRateLimit } from '../src/modules/auth/service';
import { hashPassword, tokenHash } from '../src/modules/auth/crypto';
import { teamMembers, recentAudit } from '../src/modules/core/repository';
import { changeCommercialTeamMember, commercialTeamOverview, saveCommercialTeam } from '../src/modules/commercial-teams/repository';
import { dashboard, getRecord, globalSearch, listRecords, saveRecord } from '../src/modules/crm/repository';
import { followUp, getOpportunity, getTask, indicators, listOpportunities, listTasks, opportunityFeed, pipeline, saveOpportunity } from '../src/modules/commercial/repository';
import { distributeLeads, setTeamDistribution, transferPortfolio } from '../src/modules/commercial/distribution';
import {performanceDashboard,saveGoal} from '../src/modules/commercial-goals/repository';
import type { Actor } from '../src/modules/auth/policy';
let server:EmbeddedPostgres;let orgA:string;let orgB:string;let admin:Actor;let sellerToken:string;let adminToken:string;
const password='Teste exclusivo 2026!';
before(async()=>{
  const port=await new Promise<number>(done=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const address=s.address();if(typeof address==='object'&&address)s.close(()=>done(address.port));});});
  await mkdir(resolve('.local/tests'),{recursive:true});const dir=await mkdtemp(resolve('.local/tests/run-'));
  server=new EmbeddedPostgres({databaseDir:dir,user:'test_user',password:'test_db_password',port,persistent:true,authMethod:'scram-sha-256',postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
  await server.initialise();await server.start();await server.createDatabase('peclat_test');
  process.env.DATABASE_URL=`postgresql://test_user:test_db_password@127.0.0.1:${port}/peclat_test`;
  process.env.SEED_ADMIN_EMAIL='admin@test.local';process.env.SEED_ADMIN_PASSWORD=password;
  await database().query('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS');
  await migrate();await seed();
  orgA=(await database().query("SELECT id FROM organizations WHERE slug='peclat-solar'")).rows[0].id;
  orgB=(await database().query("INSERT INTO organizations(slug,name) VALUES ('outra-empresa','Outra empresa') RETURNING id")).rows[0].id;
  const hash=await hashPassword(password);
  for(const [email,org,role] of [['seller@test.local',orgA,'seller'],['outsider@test.local',orgB,'admin']]){
    const u=(await database().query('INSERT INTO users(email,name,password_hash) VALUES ($1,$1,$2) RETURNING id',[email,hash])).rows[0];
    await database().query('INSERT INTO memberships(organization_id,user_id,role_code) VALUES ($1,$2,$3)',[org,u.id,role]);
  }
  adminToken=await login({organization:'peclat-solar',email:'admin@test.local',password});admin=(await sessionActor(adminToken))!;
  sellerToken=await login({organization:'peclat-solar',email:'seller@test.local',password});
}, {timeout:120000});
after(async()=>{if(process.env.DATABASE_URL)await database().end();if(server)await server.stop();});
test('migration e seed idempotentes preservam senha existente',async()=>{
  const prior=(await database().query('SELECT password_hash FROM users WHERE email=$1',['admin@test.local'])).rows[0].password_hash;
  await migrate();process.env.SEED_ADMIN_PASSWORD='Outra senha forte 2026';await seed();
  assert.equal((await database().query('SELECT password_hash FROM users WHERE email=$1',['admin@test.local'])).rows[0].password_hash,prior);
  assert.equal((await database().query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n,16);
});
test('Hyperdrive abre e encerra um cliente por consulta e preserva a transação',async()=>{
  const key=Symbol.for('__cloudflare-context__');
  const scope=globalThis as unknown as Record<symbol,unknown>;
  const previous=scope[key];
  scope[key]={env:{HYPERDRIVE:{connectionString:process.env.DATABASE_URL}}};
  try{
    const first=(await database().query<{pid:number}>('SELECT pg_backend_pid() pid')).rows[0].pid;
    const second=(await database().query<{pid:number}>('SELECT pg_backend_pid() pid')).rows[0].pid;
    assert.notEqual(first,second);
    const [a,b]=await Promise.all([
      database().query<{pid:number}>('SELECT pg_backend_pid() pid'),
      database().query<{pid:number}>('SELECT pg_backend_pid() pid'),
    ]);
    assert.notEqual(a.rows[0].pid,b.rows[0].pid);
    const closed=await database().query<{total:number}>('SELECT count(*)::int total FROM pg_stat_activity WHERE pid=ANY($1::int[])',[[first,second,a.rows[0].pid,b.rows[0].pid]]);
    assert.equal(closed.rows[0].total,0);
    const transactionPid=await transaction(async client=>{
      const started=(await client.query<{pid:number}>('SELECT pg_backend_pid() pid')).rows[0].pid;
      const continued=(await client.query<{pid:number}>('SELECT pg_backend_pid() pid')).rows[0].pid;
      assert.equal(started,continued);
      return started;
    });
    assert.notEqual(transactionPid,(await database().query<{pid:number}>('SELECT pg_backend_pid() pid')).rows[0].pid);
    await assert.rejects(()=>transaction(async client=>{
      await client.query('INSERT INTO audit_logs(organization_id,action) VALUES ($1,$2)',[orgA,'hyperdrive.rollback']);
      throw new Error('rollback esperado');
    }),/rollback esperado/);
    assert.equal((await database().query<{total:number}>("SELECT count(*)::int total FROM audit_logs WHERE action='hyperdrive.rollback'")).rows[0].total,0);
    const prototype=pg.Client.prototype as unknown as {end:()=>Promise<void>};
    const originalEnd=prototype.end;
    prototype.end=async()=>{throw new Error('encerramento do socket já concluído');};
    try{
      const result=await transaction(async client=>{
        await client.query('INSERT INTO audit_logs(organization_id,action) VALUES ($1,$2)',[orgA,'hyperdrive.close_error']);
        return 'committed';
      });
      assert.equal(result,'committed');
      await assert.rejects(()=>transaction(async()=>{throw new Error('erro original preservado');}),/erro original preservado/);
    }finally{prototype.end=originalEnd;}
    assert.equal((await database().query<{total:number}>("SELECT count(*)::int total FROM audit_logs WHERE action='hyperdrive.close_error'")).rows[0].total,1);
  }finally{
    if(previous===undefined)delete scope[key];else scope[key]=previous;
  }
});
test('tabelas públicas do CRM usam RLS sem políticas abertas',async()=>{
  const tables=await database().query("SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname");
  assert.equal(tables.rowCount,63);
  assert.deepEqual(tables.rows.filter(table=>!table.relrowsecurity),[]);
  assert.equal((await database().query("SELECT count(*)::int n FROM pg_policies WHERE schemaname='public'")).rows[0].n,0);
  assert.equal((await database().query("SELECT count(*)::int n FROM information_schema.role_table_grants WHERE table_schema='public' AND grantee IN ('anon','authenticated','service_role')")).rows[0].n,0);
});
test('login rejeita tenant alheio, credenciais inválidas e token forjado',async()=>{
  await assert.rejects(()=>login({organization:'outra-empresa',email:'admin@test.local',password}),{status:401});
  await assert.rejects(()=>login({organization:'peclat-solar',email:'admin@test.local',password:'errada'}),{status:401});
  assert.equal(await sessionActor('a'.repeat(64)),null);assert.equal(await sessionActor('invalid'),null);
});
test('permissões efetivas e consultas não vazam membros ou auditoria de outro tenant',async()=>{
  assert.equal(admin.organizationId,orgA);const team=await teamMembers(admin);
  assert.equal(team.length,2);assert.ok(team.every(u=>u.email!=='outsider@test.local'));
  const seller=(await sessionActor(sellerToken))!;await assert.rejects(()=>teamMembers(seller),{status:403});
  await database().query("INSERT INTO audit_logs(organization_id,action) VALUES ($1,'other.private')",[orgB]);
  assert.ok((await recentAudit(admin)).every(e=>e.action!=='other.private'));
  await assert.rejects(()=>recentAudit(seller),{status:403});
});
test('equipes comerciais usam membros existentes, respeitam organização e preservam histórico',async()=>{
  const hash=await hashPassword(password);
  const ids:string[]=[];
  for(const [email,role] of [['manager1@test.local','manager'],['manager2@test.local','manager'],['seller2@test.local','seller']]){
    const user=(await database().query('INSERT INTO users(email,name,password_hash) VALUES ($1,$1,$2) RETURNING id',[email,hash])).rows[0];
    await database().query('INSERT INTO memberships(organization_id,user_id,role_code) VALUES ($1,$2,$3)',[orgA,user.id,role]);
    ids.push(user.id);
  }
  const [managerId,secondManagerId,secondSellerId]=ids;
  const manager=(await sessionActor(await login({organization:'peclat-solar',email:'manager1@test.local',password})))!;
  const seller=(await sessionActor(sellerToken))!;
  const outsider=(await sessionActor(await login({organization:'outra-empresa',email:'outsider@test.local',password})))!;
  assert.ok(manager.permissions.includes('commercial_team.manage'));
  assert.ok(seller.permissions.includes('commercial_team.read'));
  await assert.rejects(()=>saveCommercialTeam(seller,{name:'Equipe Florianópolis',manager_user_id:managerId}),{status:403});
  await assert.rejects(()=>saveCommercialTeam(admin,{name:'Equipe inválida',manager_user_id:seller.userId}),{status:400});
  const teamId=await saveCommercialTeam(manager,{name:'Equipe Florianópolis',description:'Operação regional',manager_user_id:managerId,active:true});
  await assert.rejects(()=>saveCommercialTeam(admin,{name:'equipe florianópolis',manager_user_id:managerId,active:true}),{status:409});
  await changeCommercialTeamMember(manager,teamId,{user_id:seller.userId,action:'add'});
  await assert.rejects(()=>changeCommercialTeamMember(manager,teamId,{user_id:seller.userId,action:'add'}),{status:409});
  await assert.rejects(()=>changeCommercialTeamMember(outsider,teamId,{user_id:seller.userId,action:'remove'}),{status:404});
  const lead=(await database().query("INSERT INTO crm_records(organization_id,kind,owner_id,name) VALUES ($1,'lead',$2,'Lead da equipe') RETURNING id",[orgA,seller.userId])).rows[0].id;
  await database().query("INSERT INTO crm_records(organization_id,kind,owner_id,name) VALUES ($1,'customer',$2,'Cliente da equipe')",[orgA,seller.userId]);
  await database().query("INSERT INTO crm_opportunities(organization_id,title,lead_id,owner_id) VALUES ($1,'Projeto da equipe',$2,$3)",[orgA,lead,seller.userId]);
  await database().query("INSERT INTO crm_tasks(organization_id,record_id,owner_id,title,due_at,due_date) VALUES ($1,$2,$3,'Ligar para cliente',now()+interval '1 day',current_date+1)",[orgA,lead,seller.userId]);
  const own=await commercialTeamOverview(seller);
  assert.equal(own.teams.length,1);assert.deepEqual(own.members.map(member=>member.id),[seller.userId]);
  assert.deepEqual([own.members[0].leads,own.members[0].customers,own.members[0].opportunities_open,own.members[0].tasks_open],[1,1,1,1]);
  assert.equal((await commercialTeamOverview(outsider)).teams.length,0);
  const first=(await commercialTeamOverview(admin)).teams.find(team=>team.id===teamId)!;
  await assert.rejects(()=>saveCommercialTeam(admin,{name:first.name,description:'',manager_user_id:managerId,active:true,version:first.version+1},teamId),{status:409});
  await saveCommercialTeam(admin,{name:first.name,description:'Nova descrição',manager_user_id:secondManagerId,active:false,version:first.version},teamId);
  await assert.rejects(()=>changeCommercialTeamMember(admin,teamId,{user_id:secondSellerId,action:'add'}),{status:409});
  await changeCommercialTeamMember(admin,teamId,{user_id:seller.userId,action:'remove'});
  await database().query('UPDATE users SET active=false WHERE id=$1',[secondSellerId]);
  const inactive=(await commercialTeamOverview(admin)).members.find(member=>member.id===secondSellerId)!;
  assert.equal(inactive.active,false);
  await database().query('UPDATE users SET active=true WHERE id=$1',[secondSellerId]);
  const updated=(await commercialTeamOverview(admin)).teams.find(team=>team.id===teamId)!;
  await saveCommercialTeam(admin,{name:updated.name,description:updated.description,manager_user_id:secondManagerId,active:true,version:updated.version},teamId);
  await database().query('UPDATE users SET active=false WHERE id=$1',[secondSellerId]);
  await assert.rejects(()=>changeCommercialTeamMember(admin,teamId,{user_id:secondSellerId,action:'add'}),{status:400});
  await database().query('UPDATE users SET active=true WHERE id=$1',[secondSellerId]);
  await changeCommercialTeamMember(admin,teamId,{user_id:secondSellerId,action:'add'});
  const final=await commercialTeamOverview(admin);
  assert.equal(final.teams.find(team=>team.id===teamId)?.member_count,1);
  assert.ok(final.history.some(event=>event.action==='manager_changed'));
  assert.ok(final.history.some(event=>event.action==='member_removed'));
  assert.ok(final.history.some(event=>event.action==='reactivated'));
  assert.equal((await database().query('SELECT count(*)::int n FROM commercial_team_members WHERE organization_id=$1 AND user_id=$2',[orgA,secondSellerId])).rows[0].n,1);
});
test('carteira comercial limita gerente à equipe, vendedor ao próprio e admin à organização',async()=>{
  const users=await database().query("SELECT id,email FROM users WHERE email IN ('manager1@test.local','manager2@test.local','seller@test.local','seller2@test.local')");
  const ids=Object.fromEntries(users.rows.map(row=>[row.email,row.id])) as Record<string,string>;
  const manager=(await sessionActor(await login({organization:'peclat-solar',email:'manager1@test.local',password})))!;
  const seller=(await sessionActor(sellerToken))!;
  const teamId=await saveCommercialTeam(manager,{name:'Equipe carteira 7.2',manager_user_id:manager.userId});
  await changeCommercialTeamMember(manager,teamId,{user_id:seller.userId,action:'add'});
  const hash=await hashPassword(password);
  const extra=(await database().query("INSERT INTO users(email,name,password_hash) VALUES ('seller3@test.local','Vendedor três',$1) RETURNING id",[hash])).rows[0].id as string;
  await database().query("INSERT INTO memberships(organization_id,user_id,role_code) VALUES ($1,$2,'seller')",[orgA,extra]);
  await changeCommercialTeamMember(manager,teamId,{user_id:extra,action:'add'});
  const createLead=async(name:string,owner:string|null)=>
    (await database().query("INSERT INTO crm_records(organization_id,kind,owner_id,name) VALUES ($1,'lead',$2,$3) RETURNING id",[orgA,owner,name])).rows[0].id as string;
  const own=await createLead('Carteira Alfa exclusiva',seller.userId);
  const other=await createLead('Carteira Beta exclusiva',ids['seller2@test.local']);
  const free=await createLead('Carteira sem responsável',null);
  const outsiderId=(await database().query("SELECT user_id FROM memberships WHERE organization_id=$1 AND role_code='admin'",[orgB])).rows[0].user_id as string;
  const foreign=(await database().query("INSERT INTO crm_records(organization_id,kind,owner_id,name) VALUES ($1,'lead',$2,'Carteira outra organização') RETURNING id",[orgB,outsiderId])).rows[0].id as string;
  const opportunity=(await database().query('INSERT INTO crm_opportunities(organization_id,title,lead_id,owner_id) VALUES ($1,$2,$3,$4) RETURNING id',[orgA,'Projeto Alfa exclusivo',own,seller.userId])).rows[0].id as string;
  await database().query('INSERT INTO crm_opportunities(organization_id,title,lead_id,owner_id) VALUES ($1,$2,$3,$4)',[orgA,'Projeto Beta exclusivo',other,ids['seller2@test.local']]);
  const managerRecords=await listRecords(manager,'lead',{status:'all'});
  assert.ok(managerRecords.records.some(row=>row.id===own));
  assert.ok(managerRecords.records.some(row=>row.id===free));
  assert.ok(!managerRecords.records.some(row=>row.id===other));
  assert.ok(!managerRecords.records.some(row=>row.id===foreign));
  assert.ok((await listRecords(admin,'lead',{status:'all'})).records.some(row=>row.id===other));
  assert.ok(!(await listRecords(seller,'lead',{status:'all'})).records.some(row=>row.id===other));
  assert.equal((await listRecords(manager,'lead',{view:'unassigned'})).records.some(row=>row.id===free),true);
  await assert.rejects(()=>listRecords(seller,'lead',{view:'unassigned'}),{status:403});
  await assert.rejects(()=>getRecord(manager,other),{status:404});
  assert.equal((await globalSearch(manager,'Carteira Beta')).lead.length,0);
  assert.equal((await globalSearch(admin,'Carteira Beta')).lead.length,1);
  assert.ok((await listOpportunities(manager,{})).items.some(row=>row.id===opportunity));
  assert.ok(!(await listOpportunities(manager,{})).items.some(row=>row.title==='Projeto Beta exclusivo'));
  assert.equal((await pipeline(seller,{})).total>=1,true);
  assert.ok((await dashboard(manager)).leads>=(await dashboard(seller)).leads);
  const otherOpportunityId=(await database().query("SELECT id FROM crm_opportunities WHERE title='Projeto Beta exclusivo'")).rows[0].id as string;
  await assert.rejects(()=>getOpportunity(seller,otherOpportunityId),{status:404});
  await assert.rejects(()=>distributeLeads(manager,{mode:'manual',owner_id:ids['seller2@test.local'],leads:[{id:free,version:1}]}),{status:403});
  await assert.rejects(()=>distributeLeads(seller,{mode:'manual',owner_id:seller.userId,leads:[{id:free,version:1}]}),{status:403});
  await assert.rejects(()=>distributeLeads(admin,{mode:'manual',owner_id:ids['seller2@test.local'],leads:[{id:foreign,version:1}]}),{status:409});
  assert.deepEqual(await distributeLeads(manager,{mode:'manual',owner_id:seller.userId,leads:[{id:free,version:1}]}),{assigned:1});
  assert.equal((await getRecord(seller,free)).owner_id,seller.userId);
  await assert.rejects(()=>distributeLeads(manager,{mode:'manual',owner_id:extra,leads:[{id:free,version:1}]}),{status:409});
  const switched=await saveRecord(manager,'lead',{name:'Carteira Alfa exclusiva',owner_id:extra,version:1},own);
  assert.equal(switched.owner_id,extra);
  assert.ok((await database().query("SELECT detail FROM crm_activities WHERE record_id=$1 AND action='owner.changed'",[own])).rows[0].detail.includes('->'));
  const team=(await commercialTeamOverview(manager)).teams.find(row=>row.id===teamId)!;
  await setTeamDistribution(manager,teamId,{enabled:true,version:team.version});
  const batch=[await createLead('Round Robin Um',null),await createLead('Round Robin Dois',null),await createLead('Round Robin Três',null)];
  const [first,second]=await Promise.all([
    distributeLeads(manager,{mode:'automatic',team_id:teamId,leads:[{id:batch[0],version:1},{id:batch[1],version:1}]}),
    distributeLeads(manager,{mode:'automatic',team_id:teamId,leads:[{id:batch[2],version:1}]}),
  ]);
  assert.equal(first.assigned+second.assigned,3);
  const assigned=(await database().query('SELECT owner_id FROM crm_records WHERE id=ANY($1::uuid[]) ORDER BY id',[batch])).rows;
  assert.equal(assigned.length,3);
  assert.equal(new Set(assigned.map(row=>row.owner_id)).size,2);
  assert.equal((await database().query('SELECT distribution_cursor FROM commercial_teams WHERE id=$1',[teamId])).rows[0].distribution_cursor,'3');
  await assert.rejects(()=>distributeLeads(manager,{mode:'automatic',team_id:teamId,leads:[{id:batch[0],version:2}]}),{status:409});
  await database().query('UPDATE users SET active=false WHERE id=$1',[extra]);
  await assert.rejects(()=>distributeLeads(manager,{mode:'manual',owner_id:extra,leads:[{id:free,version:2}]}),{status:400});
  const last=await createLead('Round Robin Inativo',null);
  await distributeLeads(manager,{mode:'automatic',team_id:teamId,leads:[{id:last,version:1}]});
  assert.equal((await database().query('SELECT owner_id FROM crm_records WHERE id=$1',[last])).rows[0].owner_id,seller.userId);
  await database().query('UPDATE users SET active=true WHERE id=$1',[extra]);
  const transfer=await transferPortfolio(manager,{from_user_id:seller.userId,to_user_id:extra,confirm:true});
  assert.ok((transfer.records??0)>=2&&(transfer.opportunities??0)>=1);
  assert.equal((await database().query('SELECT owner_id FROM crm_opportunities WHERE id=$1',[opportunity])).rows[0].owner_id,extra);
  assert.ok((await database().query("SELECT count(*)::int n FROM crm_activities WHERE record_id=$1 AND action='portfolio.transferred'",[free])).rows[0].n>=1);
  await assert.rejects(()=>transferPortfolio(manager,{from_user_id:ids['seller2@test.local'],to_user_id:extra,confirm:true}),{status:403});
});
async function portfolioFixture(slug:string){
  const organizationId=(await database().query('INSERT INTO organizations(slug,name) VALUES ($1,$1) RETURNING id',[slug])).rows[0].id as string;
  const actors:Actor[]=[];
  const hash=(await database().query('SELECT password_hash FROM users WHERE id=$1',[admin.userId])).rows[0].password_hash;
  for(const [index,role] of ['admin','manager','seller','seller','manager','seller'].entries()){
    const email=`${slug}-${index}@test.local`;
    const userId=(await database().query('INSERT INTO users(email,name,password_hash) VALUES ($1,$1,$2) RETURNING id',[email,hash])).rows[0].id as string;
    await database().query('INSERT INTO memberships(organization_id,user_id,role_code) VALUES ($1,$2,$3)',[organizationId,userId,role]);
    const permissions=(await database().query<{permission_code:string}>('SELECT permission_code FROM role_permissions WHERE role_code=$1',[role])).rows.map(row=>row.permission_code);
    actors.push({userId,organizationId,organizationName:slug,organizationSlug:slug,name:email,email,role,roleName:role,permissions});
  }
  const [administrator,manager,first,second,otherManager,otherSeller]=actors;
  const teamId=await saveCommercialTeam(administrator,{name:'Equipe principal',manager_user_id:manager.userId});
  await changeCommercialTeamMember(administrator,teamId,{user_id:first.userId,action:'add'});
  await changeCommercialTeamMember(administrator,teamId,{user_id:second.userId,action:'add'});
  const otherTeamId=await saveCommercialTeam(administrator,{name:'Outra equipe',manager_user_id:otherManager.userId});
  await changeCommercialTeamMember(administrator,otherTeamId,{user_id:otherSeller.userId,action:'add'});
  const createRecord=async(kind:'lead'|'customer'|'company',owner:string|null,name:string)=>(await database().query(
    "INSERT INTO crm_records(organization_id,kind,owner_id,name,person_type) VALUES ($1,$2,$3,$4,CASE WHEN $2='company' THEN 'PJ' ELSE 'PF' END) RETURNING id",[organizationId,kind,owner,name])).rows[0].id as string;
  return {organizationId,administrator,manager,first,second,otherManager,otherSeller,teamId,otherTeamId,createRecord};
}

test('escopos own/team/all isolam cadastros, filtros, busca, dashboard, pipeline e tarefas',async()=>{
  const fixture=await portfolioFixture('scope-phase72');
  const {organizationId,administrator,manager,first,second,otherSeller,teamId,otherTeamId,createRecord}=fixture;
  const owners=[manager,first,second,otherSeller];
  const records:{kind:'lead'|'customer'|'company';owner:string;id:string}[]=[];
  for(const kind of ['lead','customer','company'] as const){
    for(const owner of owners)records.push({kind,owner:owner.userId,id:await createRecord(kind,owner.userId,`Escopo ${kind} ${owner.name}`)});
  }
  const free=await createRecord('lead',null,'Escopo sem responsável');
  const foreign=(await database().query("INSERT INTO crm_records(organization_id,kind,owner_id,name) VALUES ($1,'customer',$2,'Escopo organização alheia') RETURNING id",[orgA,admin.userId])).rows[0].id as string;
  const sorted=(ids:string[])=>ids.slice().sort();
  for(const kind of ['lead','customer','company'] as const){
    const ownIds=records.filter(row=>row.kind===kind&&row.owner===first.userId).map(row=>row.id);
    const teamIds=records.filter(row=>row.kind===kind&&row.owner!==otherSeller.userId).map(row=>row.id);
    if(kind==='lead')teamIds.push(free);
    assert.deepEqual(sorted((await listRecords(first,kind,{})).records.map(row=>row.id)),sorted(ownIds));
    assert.deepEqual(sorted((await listRecords(manager,kind,{})).records.map(row=>row.id)),sorted(teamIds));
    assert.equal((await listRecords(administrator,kind,{view:'all'})).total,kind==='lead'?5:4);
    assert.equal((await listRecords(manager,kind,{view:'mine'})).total,1);
    assert.equal((await listRecords(manager,kind,{view:'team',team:teamId})).total,2);
    assert.equal((await listRecords(manager,kind,{team:otherTeamId})).total,0);
    assert.equal((await listRecords(administrator,kind,{team:otherTeamId})).total,1);
    assert.equal((await listRecords(manager,kind,{owner:otherSeller.userId})).total,0);
    await assert.rejects(()=>listRecords(first,kind,{team:teamId}),{status:403});
    await assert.rejects(()=>listRecords(manager,kind,{view:'all'}),{status:403});
    const search=await globalSearch(manager,'Escopo');
    assert.deepEqual(sorted((search[kind] as {id:string}[]).map(row=>row.id)),sorted(teamIds));
    assert.deepEqual(sorted(((await globalSearch(first,'Escopo'))[kind] as {id:string}[]).map(row=>row.id)),sorted(ownIds));
    const hidden=records.find(row=>row.kind===kind&&row.owner===otherSeller.userId)!;
    await assert.rejects(()=>getRecord(manager,hidden.id),{status:404});
    await assert.rejects(()=>getRecord(first,hidden.id),{status:404});
  }
  await assert.rejects(()=>getRecord(administrator,foreign),{status:404});
  for(const [actor,leads,customers] of [[administrator,5,4],[manager,4,3],[first,1,1]] as const){
    const overview=await dashboard(actor);
    assert.equal(overview.leads,leads);assert.equal(overview.customers,customers);
    assert.equal(overview.grouped.owner.reduce((sum,row)=>sum+row.total,0),leads);
  }
  const opportunityIds=new Map<string,string>();
  const taskIds=new Map<string,string>();
  for(const owner of owners){
    const lead=records.find(row=>row.kind==='lead'&&row.owner===owner.userId)!.id;
    const opportunity=(await database().query(`INSERT INTO crm_opportunities(organization_id,title,lead_id,owner_id,estimated_value,last_activity_at,stage_changed_at,expected_close)
      VALUES ($1,$2,$3,$4,100,now()-interval '30 days',now()-interval '30 days',(now() AT TIME ZONE 'America/Sao_Paulo')::date+1) RETURNING id`,[organizationId,`Escopo projeto ${owner.name}`,lead,owner.userId])).rows[0].id as string;
    const task=(await database().query(`INSERT INTO crm_tasks(organization_id,record_id,owner_id,title,due_at,due_date)
      VALUES ($1,$2,$3,$4,now()-interval '1 day',(now() AT TIME ZONE 'America/Sao_Paulo')::date-1) RETURNING id`,[organizationId,lead,owner.userId,`Escopo tarefa ${owner.name}`])).rows[0].id as string;
    opportunityIds.set(owner.userId,opportunity);taskIds.set(owner.userId,task);
  }
  for(const [actor,total] of [[administrator,4],[manager,3],[first,1]] as const){
    assert.equal((await listOpportunities(actor,{})).total,total);
    const board=await pipeline(actor,{});assert.equal(board.total,total);assert.equal(board.value_total,total*100);
    assert.equal((await listTasks(actor,{})).total,total);
    const follow=await followUp(actor);
    assert.equal(follow.inactive.length,total);assert.equal(follow.stalled.length,total);assert.equal(follow.closing.length,total);assert.equal(follow.overdue.total,total);
    const summary=await indicators(actor);assert.equal(summary.open_count,total);assert.equal(summary.pending_tasks,total);
  }
  assert.equal((await listOpportunities(manager,{view:'mine'})).total,1);
  assert.equal((await listOpportunities(manager,{team:teamId})).total,2);
  assert.equal((await listTasks(manager,{view:'mine'})).total,1);
  assert.equal((await listTasks(manager,{team:teamId})).total,2);
  assert.equal((await listTasks(manager,{team:otherTeamId})).total,0);
  assert.equal((await listOpportunities(manager,{owner:otherSeller.userId})).total,0);
  await assert.rejects(()=>getTask(manager,taskIds.get(otherSeller.userId)!),{status:404});
  await assert.rejects(()=>getOpportunity(first,opportunityIds.get(second.userId)!),{status:404});
  await assert.rejects(()=>listTasks(first,{view:'team'}),{status:403});
  await assert.rejects(()=>listOpportunities(first,{view:'all'}),{status:403});
  await database().query('UPDATE users SET active=false WHERE id=$1',[second.userId]);
  assert.equal((await listRecords(manager,'customer',{})).total,3,'Histórico do vendedor inativo continua visível à gestão.');
  await database().query('UPDATE commercial_teams SET active=false WHERE id=$1',[teamId]);
  assert.equal((await listRecords(manager,'customer',{})).total,1);
  assert.equal((await listOpportunities(manager,{})).total,1);
  assert.equal((await listTasks(manager,{})).total,1);
});

test('distribuição em lote é atômica e round-robin concorre sem atribuir o mesmo lead duas vezes',async()=>{
  const {organizationId,administrator,manager,first,second,otherSeller,teamId,otherTeamId,createRecord}=await portfolioFixture('distribution-phase72');
  await changeCommercialTeamMember(manager,teamId,{user_id:second.userId,action:'remove'});
  const overview=await commercialTeamOverview(manager);
  assert.deepEqual(overview.candidates,[{id:second.userId,name:second.name}]);
  assert.ok(overview.members.every(member=>member.id!==second.userId&&member.id!==otherSeller.userId));
  assert.deepEqual((await commercialTeamOverview(first)).candidates,[]);
  await database().query('UPDATE users SET active=false WHERE id=$1',[second.userId]);
  assert.deepEqual((await commercialTeamOverview(manager)).candidates,[]);
  await assert.rejects(()=>changeCommercialTeamMember(manager,teamId,{user_id:second.userId,action:'add'}),{status:400});
  await database().query('UPDATE users SET active=true WHERE id=$1',[second.userId]);
  await database().query('UPDATE memberships SET active=false WHERE organization_id=$1 AND user_id=$2',[organizationId,second.userId]);
  assert.deepEqual((await commercialTeamOverview(manager)).candidates,[]);
  await database().query('UPDATE memberships SET active=true WHERE organization_id=$1 AND user_id=$2',[organizationId,second.userId]);
  await changeCommercialTeamMember(manager,teamId,{user_id:second.userId,action:'add'});
  assert.deepEqual((await commercialTeamOverview(manager)).candidates,[]);
  const leads=[await createRecord('lead',null,'Lote primeiro'),await createRecord('lead',null,'Lote segundo')];
  assert.deepEqual(await distributeLeads(manager,{mode:'manual',owner_id:first.userId,leads:leads.map(id=>({id,version:1}))}),{assigned:2});
  const assigned=await database().query('SELECT owner_id,version FROM crm_records WHERE id=ANY($1::uuid[])',[leads]);
  assert.ok(assigned.rows.every(row=>row.owner_id===first.userId&&row.version===2));
  assert.equal((await database().query("SELECT count(*)::int n FROM crm_activities WHERE record_id=ANY($1::uuid[]) AND action='lead.distributed_manual'",[leads])).rows[0].n,2);
  const unassigned=await createRecord('lead',null,'Lote para rollback');
  const outside=await createRecord('lead',otherSeller.userId,'Lote fora da equipe');
  await assert.rejects(()=>distributeLeads(manager,{mode:'manual',owner_id:first.userId,leads:[{id:unassigned,version:1},{id:outside,version:1}]}),{status:409});
  assert.equal((await getRecord(manager,unassigned)).owner_id,null);
  assert.equal((await getRecord(manager,unassigned)).version,1);
  await assert.rejects(()=>distributeLeads(manager,{mode:'manual',owner_id:otherSeller.userId,leads:[{id:unassigned,version:1}]}),{status:403});
  await distributeLeads(administrator,{mode:'manual',owner_id:otherSeller.userId,leads:[{id:unassigned,version:1}]});
  await assert.rejects(()=>setTeamDistribution(manager,otherTeamId,{enabled:true,version:1}),{status:404});
  await assert.rejects(()=>setTeamDistribution(admin,teamId,{enabled:true,version:1}),{status:404});
  await setTeamDistribution(manager,teamId,{enabled:true,version:1});
  const roster=(await database().query<{user_id:string}>('SELECT user_id FROM commercial_team_members WHERE team_id=$1 ORDER BY added_at,user_id',[teamId])).rows.map(row=>row.user_id);
  for(const owner of roster){
    const id=await createRecord('lead',null,'Alternância sequencial');
    await distributeLeads(manager,{mode:'automatic',team_id:teamId,leads:[{id,version:1}]});
    assert.equal((await getRecord(manager,id)).owner_id,owner);
  }
  const contested=await createRecord('lead',null,'Round-robin concorrente');
  const input={mode:'automatic',team_id:teamId,leads:[{id:contested,version:1}]};
  const attempts=await Promise.allSettled([distributeLeads(manager,input),distributeLeads(manager,input)]);
  assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);
  const rejected=attempts.find(result=>result.status==='rejected');
  assert.equal(rejected?.status==='rejected'?rejected.reason.status:undefined,409);
  assert.equal((await getRecord(manager,contested)).version,2);
  assert.equal((await database().query("SELECT count(*)::int n FROM crm_activities WHERE record_id=$1 AND action='lead.distributed_auto'",[contested])).rows[0].n,1);
  assert.equal((await database().query('SELECT distribution_cursor FROM commercial_teams WHERE id=$1',[teamId])).rows[0].distribution_cursor,'3');
  const excluded=await createRecord('lead',null,'Vendedor sem membership ativo');
  await database().query('UPDATE memberships SET active=false WHERE organization_id=$1 AND user_id=$2',[organizationId,first.userId]);
  await assert.rejects(()=>distributeLeads(manager,{mode:'manual',owner_id:first.userId,leads:[{id:excluded,version:1}]}),{status:400});
  await distributeLeads(manager,{mode:'automatic',team_id:teamId,leads:[{id:excluded,version:1}]});
  assert.equal((await getRecord(manager,excluded)).owner_id,second.userId);
  const isolated=await createRecord('lead',null,'Isolamento distribuição');
  await assert.rejects(()=>distributeLeads(manager,{mode:'automatic',team_id:otherTeamId,leads:[{id:isolated,version:1}]}),{status:404});
  await assert.rejects(()=>distributeLeads(admin,{mode:'automatic',team_id:teamId,leads:[{id:isolated,version:1}]}),{status:404});
  await assert.rejects(()=>distributeLeads(first,{mode:'automatic',team_id:teamId,leads:[{id:isolated,version:1}]}),{status:403});
  assert.equal((await getRecord(manager,isolated)).owner_id,null);
});

test('transferência preserva fechamentos e move carteira, tarefas, histórico e auditoria na organização',async()=>{
  const {organizationId,administrator,manager,first,second,otherSeller,createRecord}=await portfolioFixture('transfer-phase72');
  const lead=await createRecord('lead',first.userId,'Transferência lead');
  const customer=await createRecord('customer',first.userId,'Transferência cliente');
  const company=await createRecord('company',first.userId,'Transferência empresa');
  const deleted=await createRecord('lead',first.userId,'Transferência excluído');
  await database().query('UPDATE crm_records SET deleted_at=now() WHERE id=$1',[deleted]);
  const untouched=await createRecord('lead',otherSeller.userId,'Outra carteira preservada');
  const opportunity=await saveOpportunity(administrator,{title:'Venda concluída preservada',customer_id:customer,owner_id:first.userId,stage:'won',estimated_value:12000});
  const task=(await database().query(`INSERT INTO crm_tasks(organization_id,opportunity_id,owner_id,title,due_at,due_date)
    VALUES ($1,$2,$3,'Transferência acompanhamento',now()+interval '1 day',current_date+1) RETURNING id`,[organizationId,opportunity.id,first.userId])).rows[0].id as string;
  await assert.rejects(()=>transferPortfolio(manager,{from_user_id:first.userId,to_user_id:second.userId,confirm:false}));
  await assert.rejects(()=>transferPortfolio(first,{from_user_id:first.userId,to_user_id:second.userId,confirm:true}),{status:403});
  await assert.rejects(()=>transferPortfolio(admin,{from_user_id:first.userId,to_user_id:second.userId,confirm:true}),{status:400});
  assert.equal((await getRecord(first,lead)).owner_id,first.userId);
  await database().query('UPDATE users SET active=false WHERE id=$1',[first.userId]);
  assert.deepEqual(await transferPortfolio(manager,{from_user_id:first.userId,to_user_id:second.userId,confirm:true}),{records:3,opportunities:1,tasks:1});
  for(const id of [lead,customer,company]){
    const row=await getRecord(second,id);assert.equal(row.owner_id,second.userId);assert.equal(row.version,2);
    const history=(await database().query("SELECT detail,actor_id FROM crm_activities WHERE record_id=$1 AND action='portfolio.transferred'",[id])).rows;
    assert.equal(history.length,1);assert.equal(history[0].actor_id,manager.userId);
    assert.equal(history[0].detail,`${first.name} -> ${second.name}`);
  }
  const moved=await getOpportunity(second,opportunity.id);
  assert.equal(moved.owner_id,second.userId);assert.equal(moved.status,'won');assert.equal(moved.closed_value,12000);assert.equal(moved.closed_owner_name,first.name);
  assert.equal((await getTask(second,task)).owner_id,second.userId);assert.equal((await getTask(second,task)).version,2);
  assert.equal((await database().query("SELECT count(*)::int n FROM crm_activities WHERE opportunity_id=$1 AND action='portfolio.transferred'",[opportunity.id])).rows[0].n,1);
  const audit=await database().query("SELECT actor_id FROM audit_logs WHERE organization_id=$1 AND action='commercial.portfolio.transferred'",[organizationId]);
  assert.deepEqual(audit.rows,[{actor_id:manager.userId}]);
  assert.equal((await database().query('SELECT owner_id FROM crm_records WHERE id=$1',[deleted])).rows[0].owner_id,first.userId);
  assert.equal((await getRecord(administrator,untouched)).owner_id,otherSeller.userId);
  await assert.rejects(()=>getRecord(first,lead),{status:404});
  await assert.rejects(()=>getTask(first,task),{status:404});
});

test('oportunidade com responsável distinto preserva edição sem abrir notas de cadastro fora da equipe',async()=>{
  const {organizationId,administrator,manager,first,otherSeller,createRecord}=await portfolioFixture('linked-scope-phase72');
  const customer=await createRecord('customer',otherSeller.userId,'Cliente de outra carteira');
  const otherCustomer=await createRecord('customer',otherSeller.userId,'Outro cliente restrito');
  await database().query('INSERT INTO crm_notes(organization_id,record_id,actor_id,body) VALUES ($1,$2,$3,$4)',[organizationId,customer,administrator.userId,'Nota privada da carteira externa']);
  const opportunity=await saveOpportunity(administrator,{title:'Projeto com responsáveis diferentes',customer_id:customer,owner_id:first.userId});
  const visible=await getOpportunity(manager,opportunity.id);
  assert.equal(visible.customer_name,'Cliente de outra carteira');
  await assert.rejects(()=>getRecord(manager,customer),{status:404});
  assert.equal((await listRecords(manager,'customer',{})).total,0);
  assert.equal((await opportunityFeed(manager,opportunity.id,'notes')).total,0);
  const updated=await saveOpportunity(manager,{title:'Projeto atualizado pela gestão',customer_id:customer,owner_id:first.userId,version:opportunity.version},opportunity.id);
  assert.equal(updated.version,2);assert.equal(updated.customer_id,customer);assert.equal(updated.owner_id,first.userId);
  await assert.rejects(()=>saveOpportunity(manager,{title:updated.title,customer_id:otherCustomer,owner_id:first.userId,version:updated.version},updated.id),{status:404});
});

test('chave composta rejeita sessão com usuário de outra organização',async()=>{
  await assert.rejects(()=>database().query("INSERT INTO sessions(token_hash,user_id,organization_id,expires_at) VALUES ('forged',$1,$2,now()+interval '1 hour')",[admin.userId,orgB]),{code:'23503'});
});
test('mudança de perfil e desativação valem para sessões já emitidas',async()=>{
  const seller=(await sessionActor(sellerToken))!;
  await database().query("UPDATE memberships SET role_code='technician' WHERE user_id=$1 AND organization_id=$2",[seller.userId,orgA]);
  assert.ok((await sessionActor(sellerToken))!.permissions.includes('installations.read'));
  assert.ok(!(await sessionActor(sellerToken))!.permissions.includes('crm.own'));
  await database().query('UPDATE memberships SET active=false WHERE user_id=$1 AND organization_id=$2',[seller.userId,orgA]);
  assert.equal(await sessionActor(sellerToken),null);
  await database().query("UPDATE memberships SET active=true,role_code='seller' WHERE user_id=$1 AND organization_id=$2",[seller.userId,orgA]);
});
test('logout e expiração revogam acesso',async()=>{
  let token=await login({organization:'peclat-solar',email:'seller@test.local',password});await logout(token);assert.equal(await sessionActor(token),null);
  token=await login({organization:'peclat-solar',email:'seller@test.local',password});
  await database().query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[tokenHash(token)]);assert.equal(await sessionActor(token),null);
});
test('limite persistido é atômico em solicitações concorrentes',async()=>{
  const results=await Promise.allSettled(Array.from({length:10},()=>consumeRateLimit('parallel-limit',3,60)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,3);
  await database().query("UPDATE rate_limits SET expires_at=now()-interval '1 second' WHERE key_hash=$1",[tokenHash('parallel-limit')]);
  await consumeRateLimit('parallel-limit',3,60);
});
test('recuperação usa token único, invalida sessões e não envia para conta inexistente',async()=>{
  let link='';let deliveries=0;
  const mail={async sendRecovery(_to:string,url:string){link=url;deliveries++;}};
  await requestRecovery({organization:'peclat-solar',email:'unknown@test.local'},mail,'http://localhost:3000');assert.equal(deliveries,0);
  await requestRecovery({organization:'peclat-solar',email:'admin@test.local'},mail,'http://localhost:3000');assert.equal(deliveries,1);
  const token=link.split('#')[1];assert.ok(token);
  const nextPassword='Senha nova exclusiva 2026!';
  const attempts=await Promise.allSettled([resetPassword({token,password:nextPassword}),resetPassword({token,password:nextPassword})]);
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(await sessionActor(adminToken),null);
  assert.ok(await login({organization:'peclat-solar',email:'admin@test.local',password:nextPassword}));
});

test('metas e desempenho usam resultados reais e respeitam vendedor, equipe e organização',async()=>{
 const hash=await hashPassword(password),suffix=Date.now();
 const managerUser=(await database().query('INSERT INTO users(email,name,password_hash) VALUES ($1,$2,$3) RETURNING id',[`goals-manager-${suffix}@test.local`,'Gerente de metas',hash])).rows[0];
 const sellerUser=(await database().query('INSERT INTO users(email,name,password_hash) VALUES ($1,$2,$3) RETURNING id',[`goals-seller-${suffix}@test.local`,'Vendedor de metas',hash])).rows[0];
 const otherSeller=(await database().query('INSERT INTO users(email,name,password_hash) VALUES ($1,$2,$3) RETURNING id',[`goals-other-${suffix}@test.local`,'Vendedor externo às metas',hash])).rows[0];
 for(const [id,role] of [[managerUser.id,'manager'],[sellerUser.id,'seller'],[otherSeller.id,'seller']])await database().query('INSERT INTO memberships(organization_id,user_id,role_code) VALUES ($1,$2,$3)',[orgA,id,role]);
 const manager=(await sessionActor(await login({organization:'peclat-solar',email:`goals-manager-${suffix}@test.local`,password})))!;
 const seller=(await sessionActor(await login({organization:'peclat-solar',email:`goals-seller-${suffix}@test.local`,password})))!;
 const outside=(await sessionActor(await login({organization:'peclat-solar',email:`goals-other-${suffix}@test.local`,password})))!;
 const team=await saveCommercialTeam(manager,{name:`Equipe de metas ${suffix}`,manager_user_id:manager.userId});await changeCommercialTeamMember(manager,team,{user_id:seller.userId,action:'add'});
 const lead=(await database().query("INSERT INTO crm_records(organization_id,kind,owner_id,name,created_at) VALUES ($1,'lead',$2,'Lead meta','2026-09-02') RETURNING id",[orgA,seller.userId])).rows[0].id;
 const customer=(await database().query("INSERT INTO crm_records(organization_id,kind,owner_id,name,created_at) VALUES ($1,'customer',$2,'Cliente meta','2026-09-03') RETURNING id",[orgA,seller.userId])).rows[0].id;
 await database().query("INSERT INTO crm_activities(organization_id,record_id,actor_id,action,created_at) VALUES ($1,$2,$3,'note.created','2026-09-04')",[orgA,lead,seller.userId]);
 await database().query("INSERT INTO crm_opportunities(organization_id,title,customer_id,owner_id,stage,status,estimated_value,closed_at,closed_value,closed_by,closed_owner_id,created_at) VALUES ($1,'Venda meta',$2,$3,'won','won',5000,'2026-09-10',5000,$3,$3,'2026-09-01')",[orgA,customer,seller.userId]);
 await database().query("INSERT INTO contracts(organization_id,client_id,responsible_user_id,contract_number,title,status,total_value,net_value,balance_value,payment_method,installments_count,first_due_date,signed_at,created_by,updated_by) VALUES ($1,$2,$3,$4,'Contrato meta','signed',5000,5000,5000,'pix',1,'2026-10-01','2026-09-11',$3,$3)",[orgA,customer,seller.userId,`META-${suffix}`]);
 await database().query("INSERT INTO crm_tasks(organization_id,record_id,owner_id,title,status,due_at,due_date,completed_at,created_at) VALUES ($1,$2,$3,'Tarefa meta','completed','2026-09-12','2026-09-12','2026-09-12','2026-09-05')",[orgA,lead,seller.userId]);
 const individual=await saveGoal(manager,{target_kind:'seller',seller_user_id:seller.userId,team_id:null,metric:'sales_value',period:'monthly',starts_on:'2026-09-01',ends_on:'2026-09-30',target_value:10000});
 await saveGoal(manager,{target_kind:'team',seller_user_id:null,team_id:team,metric:'new_customers',period:'quarterly',starts_on:'2026-07-01',ends_on:'2026-09-30',target_value:3});
 const managerView=await performanceDashboard(manager,{from:'2026-09-01',to:'2026-09-30'});assert.equal(managerView.people.length,1);assert.deepEqual([managerView.people[0].leads_received,managerView.people[0].leads_worked,managerView.people[0].customers,managerView.people[0].opportunities_won,managerView.people[0].contracts,managerView.people[0].sales_value,managerView.people[0].tasks_completed],[1,1,1,1,1,5000,1]);
 assert.equal(managerView.goals.find(goal=>goal.id===individual)?.progress,50);assert.equal(managerView.goals.find(goal=>goal.team_id===team)?.actual_value,1);
 const current=managerView.goals.find(goal=>goal.id===individual)!;await saveGoal(manager,{target_kind:'seller',seller_user_id:seller.userId,team_id:null,metric:'sales_value',period:'monthly',starts_on:'2026-09-01',ends_on:'2026-09-30',target_value:6000,version:current.version},individual);
 const updated=await performanceDashboard(manager,{from:'2026-09-01',to:'2026-09-30'});assert.equal(updated.goals.find(goal=>goal.id===individual)?.target_value,6000);assert.ok(updated.history.some(item=>item.action==='updated'&&item.previous_value===10000));
 const sellerView=await performanceDashboard(seller,{from:'2026-09-01',to:'2026-09-30'});assert.deepEqual(sellerView.people.map(item=>item.user_id),[seller.userId]);assert.deepEqual(sellerView.goals.map(goal=>goal.id),[individual]);assert.equal(sellerView.can_manage,false);
 const outsideView=await performanceDashboard(outside,{from:'2026-09-01',to:'2026-09-30'});assert.equal(outsideView.goals.length,0);assert.deepEqual(outsideView.people.map(item=>item.user_id),[outside.userId]);
 await assert.rejects(()=>saveGoal(manager,{target_kind:'seller',seller_user_id:outside.userId,team_id:null,metric:'contracts_closed',period:'annual',starts_on:'2026-01-01',ends_on:'2026-12-31',target_value:2}),{status:403});
 await assert.rejects(()=>saveGoal(manager,{target_kind:'seller',seller_user_id:seller.userId,team_id:null,metric:'contracts_closed',period:'monthly',starts_on:'2026-09-02',ends_on:'2026-09-30',target_value:2}));
});
