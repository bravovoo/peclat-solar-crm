import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import LocalPostgres from '../scripts/embedded-db';
import {migrate} from '../scripts/migrate';
import {seed} from '../scripts/seed';
import {database,transaction} from '../src/server/db';
import {login,sessionActor} from '../src/modules/auth/service';
import {hashPassword} from '../src/modules/auth/crypto';
import {saveRecord} from '../src/modules/crm/repository';
import {automationSettings,listAutomationRules,saveAutomationRule,saveAutomationSettings,setAutomationRuleActive,simulateAutomationRule,updateConversationAutomation} from '../src/modules/automations/repository';
import {automationRuleInput,automationSettingsInput,isBusinessOpen} from '../src/modules/automations/domain';
import {emitAutomationEvent} from '../src/modules/automations/events';
import {processAutomationJobs,scheduleTimedAutomationJobs} from '../src/modules/automations/engine';
import type {Actor} from '../src/modules/auth/policy';

let postgres:LocalPostgres,admin:Actor,manager:Actor,seller:Actor,other:Actor,org:string,teamId:string;
const password='Automação de teste exclusiva';
const rule=(name:string,trigger_type:string,actions:Record<string,unknown>[],conditions={all:[] as {type:string;value?:unknown}[]},cooldown_minutes=0)=>({name,description:'Teste isolado',active:false,trigger_type,conditions,actions,priority:100,cooldown_minutes,version:null});
const task=(title:string)=>({type:'create_task',title,description:'Tarefa de teste',delay_minutes:15,owner_mode:'event_owner',owner_id:null,team_id:null,continue_on_error:false});
const counts=async(sql:string,params:unknown[]=[])=>Number((await database().query<{total:number}>(sql,params)).rows[0].total);

before(async()=>{
 const port=await new Promise<number>(done=>{const server=createServer();server.listen(0,'127.0.0.1',()=>{const address=server.address();if(address&&typeof address==='object')server.close(()=>done(address.port));});});
 await mkdir('.local/tests',{recursive:true});const dir=await mkdtemp(resolve('.local/tests/automations-'));
 postgres=new LocalPostgres({databaseDir:dir,user:'automation_test',password:'local_only',port,persistent:true,authMethod:'scram-sha-256',postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
 await postgres.initialise();await postgres.start();await postgres.createDatabase('automation_test');
 process.env.DATABASE_URL=`postgresql://automation_test:local_only@127.0.0.1:${port}/automation_test`;process.env.SEED_ADMIN_EMAIL='admin@automations.local';process.env.SEED_ADMIN_PASSWORD=password;
 await database().query('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS');
 await migrate();await seed();admin=(await sessionActor(await login({organization:'peclat-solar',email:'admin@automations.local',password})))!;org=admin.organizationId;
 const hash=await hashPassword(password);for(const [email,role] of [['seller@automations.local','seller'],['other@automations.local','seller'],['manager@automations.local','manager']]){const user=(await database().query<{id:string}>('INSERT INTO users(email,name,password_hash) VALUES ($1,$1,$2) RETURNING id',[email,hash])).rows[0];await database().query('INSERT INTO memberships(organization_id,user_id,role_code) VALUES ($1,$2,$3)',[org,user.id,role]);}
 seller=(await sessionActor(await login({organization:'peclat-solar',email:'seller@automations.local',password})))!;other=(await sessionActor(await login({organization:'peclat-solar',email:'other@automations.local',password})))!;
 manager=(await sessionActor(await login({organization:'peclat-solar',email:'manager@automations.local',password})))!;
 await database().query(`INSERT INTO whatsapp_integrations(organization_id,status,account_name,phone_number_id,business_account_id,display_phone_number,api_version,created_by,updated_by) VALUES ($1,'connected','Test','111111','222222','+55 31 99999-9999','v99.0',$2,$2)`,[org,admin.userId]);
 teamId=(await database().query<{id:string}>('INSERT INTO commercial_teams(organization_id,name,manager_user_id,created_by,updated_by) VALUES ($1,$2,$3,$3,$3) RETURNING id',[org,'Equipe Automação',admin.userId])).rows[0].id;
 for(const user of [seller,other])await database().query('INSERT INTO commercial_team_members(organization_id,team_id,user_id,added_by) VALUES ($1,$2,$3,$4)',[org,teamId,user.userId,admin.userId]);
},{timeout:120000});
after(async()=>{if(process.env.DATABASE_URL)await database().end();if(postgres)await postgres.stop();});

test('migration 021 mantém RLS, revoga Data API e não ativa regras',async()=>{
 const names=['organization_automation_settings','automation_rules','automation_runs','automation_run_actions','automation_jobs'];
 const tables=await database().query<{relname:string;relrowsecurity:boolean;relforcerowsecurity:boolean}>("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[])",[names]);assert.equal(tables.rowCount,5);assert.ok(tables.rows.every(row=>row.relrowsecurity&&!row.relforcerowsecurity));
 const grants=await database().query("SELECT 1 FROM information_schema.role_table_grants WHERE table_name=ANY($1::text[]) AND grantee IN ('PUBLIC','anon','authenticated','service_role')",[names]);assert.equal(grants.rowCount,0);
 assert.equal(await counts('SELECT count(*)::int total FROM automation_rules'),0);
});
test('regra nasce desativada, edita com versão, ativa, simula sem Meta e restringe vendedor',async()=>{
 const created=await saveAutomationRule(admin,rule('Criar tarefa para novo Lead','lead.created',[task('Primeiro contato')]));
 assert.equal(created.active,false);assert.equal((await listAutomationRules(admin)).some(item=>item.id===created.id),true);
 await assert.rejects(()=>listAutomationRules(seller),{status:403});
 await assert.rejects(()=>saveAutomationRule(seller,rule('Sem acesso','lead.created',[task('Inválida')])),{status:403});
 const simulation=await simulateAutomationRule(admin,created.id,{trigger_type:'lead.created',outside_business_hours:false,conversation_unassigned:false,record_kind:'lead',stage:''});assert.equal(simulation.simulation,true);assert.equal(simulation.external_actions_executed,false);
 const updated=await saveAutomationRule(admin,{...rule('Criar tarefa para novo Lead','lead.created',[task('Primeiro contato')]),description:'Descrição editada',version:created.version},created.id);assert.equal(updated.version,2);
 await assert.rejects(()=>saveAutomationRule(admin,{...rule('Erro de versão','lead.created',[task('Primeiro contato')]),version:created.version},created.id),{status:409});
 const active=await setAutomationRuleActive(admin,created.id,true,updated.version);assert.equal(active.active,true);
 const lead=await saveRecord(admin,'lead',{name:'Lead com tarefa automática'});assert.equal(await counts('SELECT count(*)::int total FROM automation_jobs WHERE automation_rule_id=$1',[created.id]),1);
 await Promise.all([processAutomationJobs(),processAutomationJobs()]);
  assert.equal(await counts("SELECT count(*)::int total FROM crm_tasks WHERE record_id=$1 AND origin='automation' AND title='Primeiro contato'",[lead.id]),1,JSON.stringify((await database().query('SELECT status,safe_error FROM automation_jobs WHERE automation_rule_id=$1',[created.id])).rows));
 assert.equal(await counts("SELECT count(*)::int total FROM automation_runs WHERE rule_id=$1 AND status='completed'",[created.id]),1);
 await setAutomationRuleActive(admin,created.id,false,active.version);
});
test('gerente enxerga somente suas regras e não executa ação em carteira fora da equipe',async()=>{
 const own=await saveAutomationRule(manager,rule('Regra do gerente','lead.created',[task('Sem acesso à carteira')]));
 assert.equal((await listAutomationRules(manager)).some(item=>item.id===own.id),true);
 const adminRule=await saveAutomationRule(admin,rule('Regra exclusiva admin','lead.created',[task('Tarefa admin')]));
 assert.equal((await listAutomationRules(manager)).some(item=>item.id===adminRule.id),false);
 await assert.rejects(()=>setAutomationRuleActive(manager,adminRule.id,true,adminRule.version),{status:404});
 await setAutomationRuleActive(manager,own.id,true,own.version);
 const lead=await saveRecord(admin,'lead',{name:'Carteira alheia ao gerente'});
 await processAutomationJobs();
 assert.equal(await counts("SELECT count(*)::int total FROM crm_tasks WHERE record_id=$1 AND title='Sem acesso à carteira'",[lead.id]),0);
 assert.equal(await counts("SELECT count(*)::int total FROM automation_runs WHERE rule_id=$1 AND status='failed' AND safe_error='automation_scope_unavailable'",[own.id]),1);
 await setAutomationRuleActive(manager,own.id,false,own.version+1);
});
test('evento repetido e cooldown impedem duplicação; depois do período liberam nova execução',async()=>{
 const created=await saveAutomationRule(admin,rule('Cooldown Lead','lead.created',[task('Retorno com cooldown')],{all:[]},120));await setAutomationRuleActive(admin,created.id,true,created.version);
 const lead=await saveRecord(admin,'lead',{name:'Lead cooldown'});
 await processAutomationJobs();
 await transaction(db=>emitAutomationEvent(db,{organizationId:org,type:'lead.created',eventId:`lead:${lead.id}:created`,entityType:'record',entityId:lead.id,recordId:lead.id}));
 await transaction(db=>emitAutomationEvent(db,{organizationId:org,type:'lead.created',eventId:`lead:${lead.id}:again`,entityType:'record',entityId:lead.id,recordId:lead.id}));
 await processAutomationJobs();assert.equal(await counts("SELECT count(*)::int total FROM crm_tasks WHERE record_id=$1 AND title='Retorno com cooldown'",[lead.id]),1);
 assert.equal(await counts("SELECT count(*)::int total FROM automation_runs WHERE rule_id=$1 AND status='skipped' AND skipped_reason='cooldown_active'",[created.id]),1);
 await database().query("UPDATE automation_runs SET created_at=now()-interval '3 hours' WHERE rule_id=$1 AND status='completed'",[created.id]);
 await transaction(db=>emitAutomationEvent(db,{organizationId:org,type:'lead.created',eventId:`lead:${lead.id}:later`,entityType:'record',entityId:lead.id,recordId:lead.id}));await processAutomationJobs();
 assert.equal(await counts("SELECT count(*)::int total FROM crm_tasks WHERE record_id=$1 AND title='Retorno com cooldown'",[lead.id]),2);
 await setAutomationRuleActive(admin,created.id,false,created.version+1);
});
test('horário comercial considera dia fechado e timezone',()=>{const hours={'1':{enabled:true,start:'08:00',end:'18:00'},'2':{enabled:true,start:'08:00',end:'18:00'},'3':{enabled:true,start:'08:00',end:'18:00'},'4':{enabled:true,start:'08:00',end:'18:00'},'5':{enabled:true,start:'08:00',end:'18:00'},'6':{enabled:false,start:'08:00',end:'12:00'},'7':{enabled:false,start:'08:00',end:'18:00'}};assert.equal(isBusinessOpen(hours,'America/Sao_Paulo',new Date('2026-09-21T15:00:00Z')),true);assert.equal(isBusinessOpen(hours,'America/Sao_Paulo',new Date('2026-09-21T23:00:00Z')),false);assert.equal(isBusinessOpen(hours,'America/Sao_Paulo',new Date('2026-09-20T15:00:00Z')),false);assert.equal(isBusinessOpen(hours,'America/New_York',new Date('2026-09-21T11:30:00Z')),false);});
test('horário aberto rejeita intervalo invertido',async()=>{const current=await automationSettings(admin);assert.equal(automationSettingsInput.safeParse({whatsapp_outbound_enabled:false,timezone:current.timezone,business_hours:{...current.business_hours,'1':{enabled:true,start:'18:00',end:'08:00'}},max_outbound_per_conversation_24h:3,max_outbound_per_rule_24h:100,version:current.version}).success,false);});
test('Tags reutilizam vínculo existente sem duplicata e rejeitam referência de outra organização',async()=>{
 const lead=await saveRecord(admin,'lead',{name:'Lead para Tags automáticas'}),tag=(await database().query<{id:string}>("INSERT INTO crm_tags(organization_id,name,color) VALUES ($1,'Automação Teste','#3388aa') RETURNING id",[org])).rows[0].id;
 const add=await saveAutomationRule(admin,rule('Adicionar Tag','lead.created',[{type:'add_tag',tag_id:tag,continue_on_error:false}]));await setAutomationRuleActive(admin,add.id,true,add.version);
 await transaction(db=>emitAutomationEvent(db,{organizationId:org,type:'lead.created',eventId:`tag:${lead.id}`,entityType:'record',entityId:lead.id,recordId:lead.id}));await processAutomationJobs();
 await transaction(db=>emitAutomationEvent(db,{organizationId:org,type:'lead.created',eventId:`tag-again:${lead.id}`,entityType:'record',entityId:lead.id,recordId:lead.id}));await processAutomationJobs();
 assert.equal(await counts('SELECT count(*)::int total FROM crm_record_tags WHERE record_id=$1 AND tag_id=$2',[lead.id,tag]),1);
 const otherOrg=(await database().query<{id:string}>("INSERT INTO organizations(slug,name) VALUES ('automation-isolated','Outra automação') RETURNING id")).rows[0].id;
 const otherTag=(await database().query<{id:string}>("INSERT INTO crm_tags(organization_id,name,color) VALUES ($1,'Tag externa','#3388aa') RETURNING id",[otherOrg])).rows[0].id;
 await assert.rejects(()=>saveAutomationRule(admin,rule('Tag de fora','lead.created',[{type:'add_tag',tag_id:otherTag,continue_on_error:false}])),{status:400});
 await setAutomationRuleActive(admin,add.id,false,add.version+1);
});
test('round-robin seleciona vendedores ativos e faz claim concorrente único',async()=>{
 const action={type:'assign_owner',mode:'round_robin',owner_id:null,team_id:teamId,continue_on_error:false};
 const created=await saveAutomationRule(admin,rule('Distribuir conversas','whatsapp.conversation_created',[action]));await setAutomationRuleActive(admin,created.id,true,created.version);
 const ids:string[]=[];for(let index=0;index<3;index++){const id=(await database().query<{id:string}>(`INSERT INTO whatsapp_conversations(organization_id,external_wa_id,phone_e164) VALUES ($1,$2,$3) RETURNING id`,[org,`5531998760${100+index}`,`+5531998760${100+index}`])).rows[0].id;ids.push(id);await transaction(db=>emitAutomationEvent(db,{organizationId:org,type:'whatsapp.conversation_created',eventId:`conversation:${id}`,entityType:'conversation',entityId:id,conversationId:id}));}
 await Promise.all([processAutomationJobs(),processAutomationJobs()]);const owners=(await database().query<{automation_owner_id:string}>('SELECT automation_owner_id FROM whatsapp_conversations WHERE id=ANY($1::uuid[]) ORDER BY id',[ids])).rows.map(row=>row.automation_owner_id);assert.equal(new Set(owners).size,2);
 await database().query('UPDATE memberships SET active=false WHERE organization_id=$1 AND user_id=$2',[org,other.userId]);const id=(await database().query<{id:string}>("INSERT INTO whatsapp_conversations(organization_id,external_wa_id,phone_e164) VALUES ($1,'5531998760999','+5531998760999') RETURNING id",[org])).rows[0].id;await transaction(db=>emitAutomationEvent(db,{organizationId:org,type:'whatsapp.conversation_created',eventId:`conversation:${id}`,entityType:'conversation',entityId:id,conversationId:id}));await processAutomationJobs();assert.equal((await database().query('SELECT automation_owner_id FROM whatsapp_conversations WHERE id=$1',[id])).rows[0].automation_owner_id,seller.userId);
 await setAutomationRuleActive(admin,created.id,false,created.version+1);
});
test('pausa, opt-out e kill switch impedem envio; mock Meta recebe somente caso autorizado',async()=>{
 const oldToken=process.env.WHATSAPP_ACCESS_TOKEN;process.env.WHATSAPP_ACCESS_TOKEN='token-falso-automations';let posts=0;const fake=async(_input:string,init?:RequestInit)=>{if(init?.method==='POST'){posts++;return new Response(JSON.stringify({messages:[{id:`wamid.automation.${posts}`}]}),{status:200,headers:{'content-type':'application/json'}});}throw new Error('unexpected_meta_call');};
 try{
  const id=(await database().query<{id:string}>("INSERT INTO whatsapp_conversations(organization_id,external_wa_id,phone_e164,last_inbound_at) VALUES ($1,'5531999999999','+5531999999999',now()) RETURNING id",[org])).rows[0].id;
  const created=await saveAutomationRule(admin,rule('Resposta controlada','whatsapp.inbound_received',[{type:'send_whatsapp_message',text:'Recebemos sua mensagem.',continue_on_error:false}],{all:[]},720));await setAutomationRuleActive(admin,created.id,true,created.version);
  const enqueue=(eventId:string)=>transaction(db=>emitAutomationEvent(db,{organizationId:org,type:'whatsapp.inbound_received',eventId,entityType:'conversation',entityId:id,conversationId:id}));
  await enqueue('inbound:kill');await processAutomationJobs(20,fake);assert.equal(posts,0);
  const initial=await automationSettings(admin);await saveAutomationSettings(admin,{whatsapp_outbound_enabled:true,timezone:initial.timezone,business_hours:initial.business_hours,max_outbound_per_conversation_24h:initial.max_outbound_per_conversation_24h,max_outbound_per_rule_24h:initial.max_outbound_per_rule_24h,version:initial.version});
  await enqueue('inbound:allowed');await processAutomationJobs(20,fake);assert.equal(posts,1);
  await enqueue('inbound:cooldown');await processAutomationJobs(20,fake);assert.equal(posts,1);
  let version=Number((await database().query('SELECT version FROM whatsapp_conversations WHERE id=$1',[id])).rows[0].version);await updateConversationAutomation(admin,id,{automations_paused:true,version});
  await enqueue('inbound:paused');await processAutomationJobs(20,fake);assert.equal(posts,1);
  version=Number((await database().query('SELECT version FROM whatsapp_conversations WHERE id=$1',[id])).rows[0].version);await updateConversationAutomation(admin,id,{automations_paused:false,version});
  version=Number((await database().query('SELECT version FROM whatsapp_conversations WHERE id=$1',[id])).rows[0].version);await updateConversationAutomation(admin,id,{automation_blocked:true,version});
  await enqueue('inbound:blocked');await processAutomationJobs(20,fake);assert.equal(posts,1);
  assert.equal(await counts("SELECT count(*)::int total FROM whatsapp_messages WHERE conversation_id=$1 AND origin='automation'",[id]),1);
  await setAutomationRuleActive(admin,created.id,false,created.version+1);
 }finally{if(oldToken===undefined)delete process.env.WHATSAPP_ACCESS_TOKEN;else process.env.WHATSAPP_ACCESS_TOKEN=oldToken;}
});
test('scheduler agenda tarefa vencida uma vez e não reprocessa cron duplicado',async()=>{
 const lead=await saveRecord(admin,'lead',{name:'Lead agendado'});const due=(await database().query<{id:string}>("INSERT INTO crm_tasks(organization_id,record_id,owner_id,title,status,due_at,due_date) VALUES ($1,$2,$3,'Tarefa vencida','pending',now()-interval '1 hour',CURRENT_DATE) RETURNING id",[org,lead.id,admin.userId])).rows[0].id;
 const created=await saveAutomationRule(admin,rule('Cobrar tarefa vencida','task.overdue',[task('Revisar pendência')]));await setAutomationRuleActive(admin,created.id,true,created.version);
 await Promise.all([scheduleTimedAutomationJobs(),scheduleTimedAutomationJobs()]);assert.equal(await counts('SELECT count(*)::int total FROM automation_jobs WHERE automation_rule_id=$1 AND entity_id=$2',[created.id,due]),1);
 await Promise.all([processAutomationJobs(),processAutomationJobs()]);assert.equal(await counts("SELECT count(*)::int total FROM crm_tasks WHERE record_id=$1 AND title='Revisar pendência'",[lead.id]),1);
 await setAutomationRuleActive(admin,created.id,false,created.version+1);
});
test('conversa sem resposta agenda uma tarefa somente após o tempo configurado',async()=>{
 const lead=await saveRecord(admin,'lead',{name:'Lead sem resposta'});
 const conversation=(await database().query<{id:string}>("INSERT INTO whatsapp_conversations(organization_id,external_wa_id,phone_e164,record_id,last_inbound_at) VALUES ($1,'5531998760777','+5531998760777',$2,now()-interval '40 minutes') RETURNING id",[org,lead.id])).rows[0].id;
 const created=await saveAutomationRule(admin,rule('Sem resposta em 30 minutos','no_reply_for_duration',[task('Responder conversa')],{all:[{type:'elapsed_minutes',value:30}]}));
 await setAutomationRuleActive(admin,created.id,true,created.version);
 await scheduleTimedAutomationJobs();await processAutomationJobs();
 assert.equal(await counts("SELECT count(*)::int total FROM crm_tasks WHERE record_id=$1 AND title='Responder conversa'",[lead.id]),1);
 await scheduleTimedAutomationJobs();await processAutomationJobs();
 assert.equal(await counts('SELECT count(*)::int total FROM automation_jobs WHERE automation_rule_id=$1 AND entity_id=$2',[created.id,conversation]),1);
 await setAutomationRuleActive(admin,created.id,false,created.version+1);
});
test('schema de regras rejeita chaves externas, tempo fora de gatilho agendado e ação inválida',()=>{const input=rule('Regra inválida','lead.created',[task('Atender')]);assert.equal(automationRuleInput.safeParse({...input,organization_id:randomUUID()}).success,false);assert.equal(automationRuleInput.safeParse({...input,actions:[{type:'send_whatsapp_message',text:'',continue_on_error:false}]}).success,false);assert.equal(automationRuleInput.safeParse({...input,conditions:{all:[{type:'elapsed_minutes',value:30}]}}).success,false);});
