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
  assert.equal((await database().query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n,14);
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
  assert.equal(tables.rowCount,61);
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
