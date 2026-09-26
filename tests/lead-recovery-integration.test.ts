import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from 'node:net';
import {createHmac} from 'node:crypto';
import EmbeddedPostgres from '../scripts/embedded-db';
import {database} from '../src/server/db';
import {migrate} from '../scripts/migrate';
import {seed} from '../scripts/seed';
import {sessionActor,login} from '../src/modules/auth/service';
import type {Actor} from '../src/modules/auth/policy';
import {saveRecoverySettings,saveRecoveryConsent,simulateRecovery} from '../src/modules/lead-recovery/repository';
import {refreshLeadRecoveryEnrollments,processLeadRecoveryAttempts} from '../src/modules/lead-recovery/engine';
import {receiveMetaWebhook} from '../src/modules/whatsapp/webhook';
import {loadLeadFacts,assessLead,loadRecoveryConfig} from '../src/modules/lead-recovery/eligibility';
let server:EmbeddedPostgres,admin:Actor;let n=0;
const base=new Date('2030-01-07T14:00:00Z'); // Monday 11h São Paulo
const at=(days:number,hour=14)=>{const d=new Date(base.getTime()+days*86400000);d.setUTCHours(hour,0,0,0);return d;};
const hours=Object.fromEntries(['1','2','3','4','5','6','7'].map(day=>[day,{enabled:true,start:'10:00',end:'14:00'}]));
before(async()=>{
 const port=await new Promise<number>(done=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const a=s.address();if(a&&typeof a==='object')s.close(()=>done(a.port));});});
 await mkdir(resolve('.local/tests'),{recursive:true});const dir=await mkdtemp(resolve('.local/tests/recovery-'));
 server=new EmbeddedPostgres({databaseDir:dir,user:'test_user',password:'test_db_password',port,persistent:true,authMethod:'scram-sha-256',postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
 await server.initialise();await server.start();await server.createDatabase('recovery_test');
 process.env.DATABASE_URL=`postgresql://test_user:test_db_password@127.0.0.1:${port}/recovery_test`;
 process.env.SEED_ADMIN_EMAIL='recovery@test.local';process.env.SEED_ADMIN_PASSWORD='Local ficticio 2030!';process.env.WHATSAPP_ACCESS_TOKEN='mock-only';
 await migrate();await seed();admin=(await sessionActor(await login({organization:'peclat-solar',email:'recovery@test.local',password:'Local ficticio 2030!'})))!;
},{timeout:120000});
after(async()=>{await database().end();if(server)await server.stop();});
type Fixture={org:string;actor:Actor;lead:string;conversation:string;wa:string;phoneId:string;businessId:string;templates:string[]};
async function fixture(consent=true):Promise<Fixture>{
 n++;await database().query('UPDATE organization_lead_recovery_settings SET enabled=false');
 const org=(await database().query('INSERT INTO organizations(slug,name) VALUES ($1,$2) RETURNING id',[`recovery-${n}`,`Fictícia ${n}`])).rows[0].id;
 await database().query("INSERT INTO memberships(organization_id,user_id,role_code) VALUES ($1,$2,'admin')",[org,admin.userId]);
 const actor={...admin,organizationId:org},phoneId=`12345678${n}`,businessId=`98765432${n}`,wa=`553199990${String(n).padStart(4,'0')}`;
 await database().query("INSERT INTO whatsapp_integrations(organization_id,status,account_name,phone_number_id,business_account_id,display_phone_number,api_version,created_by,updated_by) VALUES ($1,'connected','Fictícia',$2,$3,'+5531999999999','v25.0',$4,$4)",[org,phoneId,businessId,admin.userId]);
 await database().query('INSERT INTO organization_automation_settings(organization_id,whatsapp_outbound_enabled,updated_by) VALUES ($1,true,$2)',[org,admin.userId]);
 const templates:string[]=[];for(let i=1;i<=3;i++)templates.push((await database().query("INSERT INTO whatsapp_templates(organization_id,meta_template_id,name,language,category,status,components,supported) VALUES ($1,$2,$3,'pt_BR','MARKETING','APPROVED',$4,true) RETURNING id",[org,`test-${i}`,`peclat_recuperacao_lead_${i}`,JSON.stringify([{type:'BODY',text:'Olá {{1}}'}])])).rows[0].id);
 // Real inbound pipeline creates an unassigned lead, then company replies.
 const partial={org,actor,wa,phoneId,businessId,templates};await inbound(partial,at(-1));
 const c=(await database().query('SELECT id,record_id FROM whatsapp_conversations WHERE organization_id=$1',[org])).rows[0];
 const f={...partial,lead:c.record_id,conversation:c.id};await outbound(f,base);
 if(consent){const pref=(await database().query('SELECT version FROM crm_contact_preferences WHERE organization_id=$1 AND record_id=$2',[org,f.lead])).rows[0];await saveRecoveryConsent(actor,f.lead,{whatsapp_consent_status:'opted_in',consent_source:'Fixture explícita',version:pref.version});}
 await saveRecoverySettings(actor,{enabled:true,include_uncontacted:false,timezone:'America/Sao_Paulo',business_hours:hours,lead_stages:['new'],seller_ids:[],steps:[2,5,7,10].map((day,i)=>({position:i+1,delay_days:day,template_id:templates[Math.min(i,2)],header_parameters:[],body_parameters:['{{lead_first_name}}']})),version:1});return f;
}
async function inbound(f:Pick<Fixture,'wa'|'phoneId'|'businessId'>,date:Date){
 const raw=Buffer.from(JSON.stringify({object:'whatsapp_business_account',entry:[{id:f.businessId,changes:[{field:'messages',value:{metadata:{phone_number_id:f.phoneId},messages:[{from:f.wa,id:`wamid.in.${crypto.randomUUID()}`,timestamp:String(date.getTime()/1000),type:'text',text:{body:'Resposta fictícia'}}]}}]}]}));
 return receiveMetaWebhook(raw,'sha256='+createHmac('sha256','mock').update(raw).digest('hex'),'mock');
}
async function outbound(f:Fixture,date:Date,status='sent'){
 return (await database().query("INSERT INTO whatsapp_messages(organization_id,conversation_id,meta_message_id,direction,message_type,text_body,sender_wa_id,meta_timestamp,processing_status,sent_by,client_request_id,delivery_status,origin) VALUES ($1,$2,$3,'outbound','text','Teste','',$4,'processed',$5,$6,$7,'manual') RETURNING id",[f.org,f.conversation,`wamid.out.${crypto.randomUUID()}`,date,admin.userId,crypto.randomUUID(),status])).rows[0].id;
}
const sends:string[]=[];
const fake:typeof fetch=async(_url,init)=>{sends.push(JSON.parse(String(init?.body)).template.name);return new Response(JSON.stringify({messages:[{id:`wamid.mock.${crypto.randomUUID()}`}]}),{status:200});};
async function cycle(f:Fixture){return (await database().query('SELECT * FROM lead_recovery_enrollments WHERE organization_id=$1 ORDER BY created_at DESC',[f.org])).rows[0];}
async function pump(day:number,fetcher:typeof fetch=fake){await refreshLeadRecoveryEnrollments(at(day));return processLeadRecoveryAttempts(20,fetcher,at(day));}

test('quatro etapas absolutas, template 3 reutilizado, cron concorrente e conclusão definitiva',async()=>{
 const f=await fixture();sends.length=0;await refreshLeadRecoveryEnrollments(base);await refreshLeadRecoveryEnrollments(base);
 assert.equal((await database().query('SELECT count(*)::int n FROM lead_recovery_enrollments WHERE organization_id=$1',[f.org])).rows[0].n,1);
 assert.equal((await processLeadRecoveryAttempts(20,fake,at(1))).sent,0);
 for(const day of [2,5,7,10]){const results=await Promise.all([processLeadRecoveryAttempts(20,fake,at(day)),processLeadRecoveryAttempts(20,fake,at(day))]);assert.equal(results.reduce((v,r)=>v+r.sent,0),1);}
 assert.deepEqual(sends,['peclat_recuperacao_lead_1','peclat_recuperacao_lead_2','peclat_recuperacao_lead_3','peclat_recuperacao_lead_3']);
 const e=await cycle(f);assert.equal(e.status,'completed');assert.equal(e.attempt_count,4);
 const attempts=(await database().query('SELECT day_offset,eligible_at,status FROM lead_recovery_attempts WHERE organization_id=$1 ORDER BY step_position',[f.org])).rows;
 assert.deepEqual(attempts.map(a=>a.day_offset),[2,5,7,10]);assert.deepEqual(attempts.map(a=>new Date(a.eligible_at).toISOString()),[2,5,7,10].map(d=>at(d).toISOString()));
 assert.equal((await pump(20)).sent,0);assert.equal((await database().query('SELECT count(*)::int n FROM lead_recovery_enrollments WHERE organization_id=$1',[f.org])).rows[0].n,1);
});
for(const day of [3,8])test(`inbound D+${day} cancela restante e nova outbound permite ciclo futuro`,async()=>{
 const f=await fixture();await pump(2);if(day===8){await pump(5);await pump(7);}await inbound(f,at(day));
 assert.equal((await cycle(f)).status,'responded');assert.equal((await pump(10)).sent,0);
 const pending=(await database().query("SELECT count(*)::int n FROM lead_recovery_attempts WHERE organization_id=$1 AND status IN ('pending','processing')",[f.org])).rows[0].n;assert.equal(pending,0);
 await outbound(f,at(day+1));await refreshLeadRecoveryEnrollments(at(day+1));assert.equal((await cycle(f)).status,'scheduled');assert.equal(new Date((await cycle(f)).inactivity_anchor).toISOString(),at(day+1).toISOString());
 assert.equal((await pump(day+3)).sent,1);
});
test('nova manual substitui ciclo ativo; failed/pending não mudam a base',async()=>{
 const f=await fixture();await pump(2);const old=(await cycle(f)).id;await outbound(f,at(3));await refreshLeadRecoveryEnrollments(at(3));
 assert.equal((await database().query('SELECT status FROM lead_recovery_enrollments WHERE id=$1',[old])).rows[0].status,'cancelled');
 const anchor=(await cycle(f)).anchor_message_id;await outbound(f,at(4),'failed');await outbound(f,at(4),'pending');await refreshLeadRecoveryEnrollments(at(4));assert.equal((await cycle(f)).anchor_message_id,anchor);
 assert.equal((await processLeadRecoveryAttempts(20,fake,at(4))).sent,0);assert.equal((await pump(5)).sent,1);
});
test('sem consentimento ou contato inativo não entra; lead automático sem dono entra após consentimento',async()=>{
 const f=await fixture(false);assert.equal((await refreshLeadRecoveryEnrollments(at(2))).created,0);
 await saveRecoveryConsent(f.actor,f.lead,{whatsapp_consent_status:'opted_in',consent_source:'Teste',version:1});
 await database().query("UPDATE crm_records SET status='archived' WHERE id=$1",[f.lead]);assert.equal((await refreshLeadRecoveryEnrollments(at(2))).created,0);
 await database().query("UPDATE crm_records SET status='active' WHERE id=$1",[f.lead]);assert.equal((await refreshLeadRecoveryEnrollments(at(2))).created,1);
 const facts=await loadLeadFacts(database(),f.org);assert.equal(facts[0].owner_id,null);
 const before=(await database().query('SELECT count(*)::int n FROM lead_recovery_attempts WHERE organization_id=$1',[f.org])).rows[0].n;
 const sim=await simulateRecovery(f.actor,at(2));assert.equal(sim.summary.awaiting_customer,1);assert.equal(sim.summary.due_d2,1);assert.equal(sim.external_actions_executed,false);
 assert.equal((await database().query('SELECT count(*)::int n FROM lead_recovery_attempts WHERE organization_id=$1',[f.org])).rows[0].n,before);
});
test('janela SP 10–14 mantém vencida pendente sem gastar retries e respeita domingo',async()=>{
 const f=await fixture();await refreshLeadRecoveryEnrollments(base);
 await database().query('UPDATE lead_recovery_attempts SET scheduled_for=$2 WHERE organization_id=$1',[f.org,at(2,12)]);
 assert.equal((await processLeadRecoveryAttempts(20,fake,at(2,12))).sent,0);
 assert.equal((await database().query('SELECT attempts FROM lead_recovery_attempts WHERE organization_id=$1',[f.org])).rows[0].attempts,0);
 assert.equal((await processLeadRecoveryAttempts(20,fake,at(2,13))).sent,0); // due 11h, not yet due at 10h
 assert.equal((await processLeadRecoveryAttempts(20,fake,at(2,14))).sent,1);
 assert.equal((await processLeadRecoveryAttempts(20,fake,at(5,17))).sent,0);
 const a=(await database().query('SELECT scheduled_for,attempts FROM lead_recovery_attempts WHERE organization_id=$1 AND step_position=2',[f.org])).rows[0];assert.equal(new Date(a.scheduled_for).toISOString(),at(6,13).toISOString());assert.equal(a.attempts,0);
 await database().query(`UPDATE organization_lead_recovery_settings SET business_hours=jsonb_set(business_hours,'{7,enabled}','false') WHERE organization_id=$1`,[f.org]);
 assert.equal((await processLeadRecoveryAttempts(20,fake,at(6,13))).sent,0);assert.equal((await processLeadRecoveryAttempts(20,fake,at(7,13))).sent,1);
});
test('rejeição explícita usa mesma tentativa; resultado incerto nunca reenvia',async()=>{
 const f=await fixture();await refreshLeadRecoveryEnrollments(base);let calls=0;
 const rejected:typeof fetch=async()=>{calls++;return new Response(JSON.stringify({error:{code:131000,message:'Simulada'}}),{status:400});};
 assert.equal((await processLeadRecoveryAttempts(20,rejected,at(2))).sent,0);
 assert.equal((await processLeadRecoveryAttempts(20,fake,new Date(at(2).getTime()+300000))).sent,1);assert.equal(calls,1);
 assert.equal((await database().query('SELECT count(*)::int n FROM whatsapp_messages WHERE organization_id=$1 AND origin=\'lead_recovery\'',[f.org])).rows[0].n,1);
 const uncertain:typeof fetch=async()=>{calls++;throw Error('network simulated');};await processLeadRecoveryAttempts(20,uncertain,at(5));await processLeadRecoveryAttempts(20,uncertain,at(6));assert.equal(calls,2);
 assert.equal((await cycle(f)).status,'error');assert.equal((await database().query("SELECT status FROM lead_recovery_attempts WHERE organization_id=$1 AND step_position=2",[f.org])).rows[0].status,'uncertain');
});
test('inbound concorrente ao envio mantém resposta terminal e não agenda próxima etapa',async()=>{
 const f=await fixture();await refreshLeadRecoveryEnrollments(base);let started!:()=>void,release!:()=>void;
 const began=new Promise<void>(r=>started=r),go=new Promise<void>(r=>release=r);
 const slow:typeof fetch=async(u,i)=>{started();await go;return fake(u,i);};
 const processing=processLeadRecoveryAttempts(20,slow,at(2));await began;
 const response=inbound(f,new Date(at(2).getTime()+1000));release();await Promise.all([processing,response]);
 assert.equal((await cycle(f)).status,'responded');assert.equal((await pump(5)).sent,0);
});
test('inbound antes do claim e isolamento impedem recuperação errada',async()=>{
 const f=await fixture();await refreshLeadRecoveryEnrollments(base);await inbound(f,at(2));let calls=0;
 await processLeadRecoveryAttempts(20,async()=>{calls++;return fake('');},at(2));assert.equal(calls,0);
 const loaded=(await loadRecoveryConfig(database(),f.org))!,fact=(await loadLeadFacts(database(),f.org))[0];assert.equal(assessLead({...fact,enrollment_status:null},loaded.settings,loaded.steps,at(3)).reason,'awaiting_seller');
 assert.equal((await loadLeadFacts(database(),admin.organizationId,undefined,1,f.lead)).length,0);
});
test('outbound de automação/IA inicia espera e pausa global impede envio',async()=>{
 const f=await fixture();await inbound(f,at(1));
 const rule=(await database().query("INSERT INTO automation_rules(organization_id,name,trigger_type,actions,created_by,updated_by) VALUES ($1,'Fixture','whatsapp.inbound_received','[{}]',$2,$2) RETURNING id",[f.org,admin.userId])).rows[0].id;
 const run=(await database().query("INSERT INTO automation_runs(organization_id,rule_id,trigger_type,trigger_event_id) VALUES ($1,$2,'whatsapp.inbound_received','fixture') RETURNING id",[f.org,rule])).rows[0].id;
 const message=await outbound(f,at(1,15));await database().query("UPDATE whatsapp_messages SET origin='automation',automation_run_id=$2,automation_action_index=0 WHERE id=$1",[message,run]);
 assert.equal((await refreshLeadRecoveryEnrollments(at(1,15))).created,1);assert.equal((await cycle(f)).anchor_message_id,message);
 await database().query('UPDATE organization_automation_settings SET whatsapp_outbound_enabled=false WHERE organization_id=$1',[f.org]);
 assert.equal((await processLeadRecoveryAttempts(20,fake,at(3,15))).sent,0);
 assert.equal((await database().query('SELECT attempts FROM lead_recovery_attempts WHERE organization_id=$1',[f.org])).rows[0].attempts,0);
 await database().query('UPDATE organization_automation_settings SET whatsapp_outbound_enabled=true WHERE organization_id=$1',[f.org]);
 assert.equal((await processLeadRecoveryAttempts(20,fake,new Date(at(3,15).getTime()+300000))).sent,1);
});
