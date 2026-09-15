import {saveOpportunity,getOpportunity,moveOpportunity,listOpportunities,opportunityFeed,addOpportunityNote,saveTask,getTask,listTasks,updateTaskStatus,indicators,followUp,saveSettings,pipeline} from '../src/modules/commercial/repository';
import {opportunitySchema,type Opportunity} from '../src/modules/commercial/domain';
import { before,after,test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir,mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import LocalPostgres from '../scripts/embedded-db';
import { migrate } from '../scripts/migrate';
import { seed } from '../scripts/seed';
import { database } from '../src/server/db';
import { login,sessionActor } from '../src/modules/auth/service';
import { hashPassword } from '../src/modules/auth/crypto';
import type { Actor } from '../src/modules/auth/policy';
import { addContact,addNote,addTask,completeTask,crmOptions,dashboard,DuplicateError,exportRecords,getRecord,globalSearch,listRecords,mutateTag,recordAction,recordFeed,saveRecord } from '../src/modules/crm/repository';
import { csvCell,recordSchema,type CommercialRecord } from '../src/modules/crm/domain';
import { createSolarSizing,getEnergyUnit,listEnergyUnits,listSolarSizings,saveBill,saveConsumption,saveEnergyUnit,setEnergyUnitStatus } from '../src/modules/energy/repository';
import { getEquipment,getKit,listEquipment,listKits,listKitSelections,saveEquipment,saveKit,selectKitForSizing,setEquipmentStatus,setKitStatus } from '../src/modules/solar-catalog/repository';
import {createDocument,getDocument,getDocumentFile,listDocuments,sendDocumentEmail,setDocumentStatus,updateDocument} from '../src/modules/documents/repository';
import {MailConfigurationError,smtpProvider,type DocumentMailProvider} from '../src/integrations/mail';
let db:LocalPostgres;let admin:Actor;let seller:Actor;let otherSeller:Actor;let otherTenant:Actor;let lead:CommercialRecord;let customer:CommercialRecord;let tagId:string;
const password='Senha exclusiva teste CRM';
function payload(r:CommercialRecord,changes:Record<string,unknown>={}){const fields=['name','person_type','document','phone','whatsapp','email','postal_code','address','number','complement','neighborhood','city','state','owner_id','source','campaign','priority','temperature','stage','potential_value','expected_close','observations','average_consumption','utility','property_type','roof_type','consumer_units','battery_interest','financing_interest','trade_name','state_registration','website','version'];return {...Object.fromEntries(Object.entries(r).filter(([key])=>fields.includes(key))),tag_ids:r.tags.map(t=>t.id),...changes};}
before(async()=>{
 const port=await new Promise<number>(done=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const a=s.address();if(a&&typeof a==='object')s.close(()=>done(a.port));});});
 await mkdir('.local/tests',{recursive:true});const dir=await mkdtemp(resolve('.local/tests/crm-'));process.env.DOCUMENT_STORAGE_DIR=resolve(dir,'documents');
 db=new LocalPostgres({databaseDir:dir,user:'crm_test',password:'test_only',port,persistent:true,authMethod:'scram-sha-256',postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});await db.initialise();await db.start();await db.createDatabase('crm_test');
 process.env.DATABASE_URL=`postgresql://crm_test:test_only@127.0.0.1:${port}/crm_test`;process.env.SEED_ADMIN_EMAIL='admin@crm.test';process.env.SEED_ADMIN_PASSWORD=password;await migrate();await seed();
 admin=(await sessionActor(await login({organization:'peclat-solar',email:'admin@crm.test',password})))!;
 const org=(await database().query("INSERT INTO organizations(slug,name) VALUES ('outra-empresa','Empresa isolada') RETURNING id")).rows[0].id;
 const hash=await hashPassword(password);
 const actors:Actor[]=[];for(const [email,orgId,role] of [['seller@crm.test',admin.organizationId,'seller'],['seller2@crm.test',admin.organizationId,'seller'],['other@crm.test',org,'admin']]){
  const u=(await database().query('INSERT INTO users(email,name,password_hash) VALUES ($1,$1,$2) RETURNING id',[email,hash])).rows[0];await database().query('INSERT INTO memberships(organization_id,user_id,role_code) VALUES ($1,$2,$3)',[orgId,u.id,role]);actors.push((await sessionActor(await login({organization:orgId===org?'outra-empresa':'peclat-solar',email,password})))!);
 }[seller,otherSeller,otherTenant]=actors;
},{timeout:120000});
after(async()=>{if(process.env.DATABASE_URL)await database().end();if(db)await db.stop();});
test('dashboard vazio retorna zeros reais',async()=>{const data=await dashboard(admin);assert.equal(data.leads,0);assert.equal(data.customers,0);assert.deepEqual(data.grouped.source,[]);});
test('criar e visualizar lead normaliza contatos e mantém perfil solar',async()=>{
 await mutateTag(admin,{name:'Residencial',color:'#219878'});tagId=(await crmOptions(admin)).tags[0].id;
 lead=await saveRecord(seller,'lead',{name:'Projeto Solar Teste',phone:'(31) 99999-1234',email:' CLIENTE@EXAMPLE.COM ',source:'Indicação',city:'Contagem',state:'mg',average_consumption:600,roof_type:'Cerâmica',battery_interest:true,tag_ids:[tagId],potential_value:25000});
 assert.equal(lead.phone,'5531999991234');assert.equal(lead.email,'cliente@example.com');assert.equal(lead.owner_id,seller.userId);assert.equal(lead.average_consumption,600);assert.equal((await getRecord(seller,lead.id)).name,lead.name);
 assert.ok((await recordFeed(seller,lead.id,'activities')).items.some(i=>i.action==='record.created'));
});
test('edição com versão preserva registros concorrentes e registra estágio',async()=>{
 const old=lead;lead=await saveRecord(seller,'lead',payload(lead,{stage:'contact',priority:'high'}),lead.id);assert.equal(lead.version,2);
 await assert.rejects(()=>saveRecord(seller,'lead',payload(old,{name:'Conflito'}),lead.id),{status:409});
 assert.ok((await recordFeed(seller,lead.id,'activities')).items.some(i=>i.action==='stage.changed'));
});
test('busca, filtros combinados, ordenação e paginação são server-side',async()=>{
 assert.equal((await listRecords(seller,'lead',{q:'(31) 99999-1234'})).total,1);
 assert.equal((await listRecords(seller,'lead',{source:'Indicação',stage:'contact',priority:'high',city:'contagem',state:'MG',tag:tagId,owner:seller.userId,pageSize:1})).total,1);
 assert.equal((await listRecords(seller,'lead',{temperature:'cold'})).total,0);
 assert.equal((await listRecords(seller,'lead',{page:2,pageSize:1})).records.length,0);
 assert.equal((await listRecords(seller,'lead',{q:"' OR 1=1 --"})).total,0);
});
test('RBAC bloqueia IDOR, reatribuição e acesso cruzado a tags',async()=>{
 await assert.rejects(()=>getRecord(otherSeller,lead.id),{status:404});await assert.rejects(()=>getRecord(otherTenant,lead.id),{status:404});
 await assert.rejects(()=>saveRecord(seller,'lead',payload(lead,{owner_id:otherSeller.userId}),lead.id),{status:403});
 await assert.rejects(()=>saveRecord(otherTenant,'lead',{name:'Inválido',tag_ids:[tagId]}),{status:400});
 await assert.rejects(()=>mutateTag(seller,{name:'Sem permissão'}),{status:403});
 assert.equal((await listRecords(otherSeller,'lead',{})).total,0);assert.equal((await exportRecords(otherTenant,'lead',{})).length,0);
});
test('duplicidade cruzada telefone/WhatsApp e e-mail exige permissão',async()=>{
 await assert.rejects(()=>saveRecord(seller,'customer',{name:'Duplicado',whatsapp:'31999991234'}),DuplicateError);
 await assert.rejects(()=>saveRecord(seller,'lead',{name:'Duplicado',email:lead.email,allow_duplicate:true}),DuplicateError);
 try{await saveRecord(otherSeller,'lead',{name:'Privado',email:lead.email});assert.fail('deveria bloquear');}catch(e){assert.ok(e instanceof DuplicateError);assert.equal(e.matches.length,0);}
 const duplicate=await saveRecord(admin,'lead',{name:'Duplicado autorizado',email:lead.email,allow_duplicate:true});assert.ok(duplicate.id);
});
test('duplicidade concorrente não passa despercebida',async()=>{
 const results=await Promise.allSettled([saveRecord(admin,'lead',{name:'Concorrente A',email:'race@example.com'}),saveRecord(admin,'lead',{name:'Concorrente B',email:'race@example.com'})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});
test('notas e contatos aparecem no histórico e respeitam escopo',async()=>{
 await addNote(seller,{record_id:lead.id,body:'Analisar a conta de energia.'});await addContact(seller,{record_id:lead.id,name:'Contato principal',job_title:'Proprietário',email:'contato@example.com',is_primary:true});
 assert.equal((await recordFeed(seller,lead.id,'notes')).total,1);assert.equal((await recordFeed(seller,lead.id,'contacts')).items[0].is_primary,true);
 await assert.rejects(()=>addNote(otherSeller,{record_id:lead.id,body:'Ataque'}),{status:404});
 const search=await globalSearch(seller,'contato@example.com');assert.equal(search.contacts.length,1);assert.equal((await globalSearch(otherSeller,'contato@example.com')).contacts.length,0);
});
test('tarefas simples podem ser criadas e concluídas sem entrar na fase 3',async()=>{
 const task=await addTask(seller,{record_id:lead.id,title:'Solicitar conta',due_at:'2026-10-01T12:00:00Z'});
 await assert.rejects(()=>completeTask(otherSeller,task.id),{status:404});await completeTask(seller,task.id);assert.ok((await recordFeed(seller,lead.id,'tasks')).items[0].completed_at);
});
test('conversão é atômica e preserva origem, notas, contatos e tarefas',async()=>{
 customer=await recordAction(seller,lead.id,'convert',lead.version) as CommercialRecord;
 assert.equal(customer.kind,'customer');assert.equal(customer.original_lead_id,lead.id);assert.equal((await getRecord(seller,lead.id)).status,'converted');
 assert.equal((await recordFeed(seller,customer.id,'notes')).total,1);assert.equal((await recordFeed(seller,customer.id,'contacts')).total,1);assert.equal((await recordFeed(seller,customer.id,'tasks')).total,1);
 await assert.rejects(()=>recordAction(seller,lead.id,'convert',lead.version),{status:409});
 assert.equal((await listRecords(seller,'customer',{})).total,1);
});
test('empresa PJ recebe contatos e cliente pode ser criado diretamente',async()=>{
 const company=await saveRecord(admin,'company',{name:'Empresa Solar Teste',person_type:'PJ',trade_name:'Loja Teste',document:'12.ABC.345/01DE-35',website:'https://example.com'});
 assert.equal((await listRecords(admin,'company',{q:'12.ABC.345/01DE-35'})).total,1);
 await assert.rejects(()=>saveRecord(admin,'customer',{name:'Empresa duplicada',person_type:'PJ',document:'12abc34501de35'}),DuplicateError);
 await addContact(admin,{record_id:company.id,name:'Gestor de energia',is_primary:true});assert.equal((await recordFeed(admin,company.id,'contacts')).total,1);
 const client=await saveRecord(admin,'customer',{name:'Cliente direto',person_type:'PF'});assert.equal(client.original_lead_id,null);
 await assert.rejects(()=>saveRecord(admin,'company',{name:'PJ inválida',person_type:'PF'}),{status:400});
});
test('tags configuráveis, remoção de vínculo e exclusão sem apagar cadastro',async()=>{
 await mutateTag(admin,{name:'Residencial atualizado',color:'#195ca0'},tagId);assert.equal((await getRecord(seller,customer.id)).tags[0].name,'Residencial atualizado');
 await mutateTag(admin,{},tagId,true);assert.equal((await getRecord(seller,customer.id)).tags.length,0);
});
test('arquivamento e exclusão lógica preservam histórico e retiram da busca',async()=>{
 const r=await saveRecord(seller,'lead',{name:'Cadastro temporário'});await recordAction(seller,r.id,'archive',r.version);
 assert.equal((await listRecords(seller,'lead',{q:'temporário'})).total,0);assert.equal((await listRecords(seller,'lead',{q:'temporário',status:'archived'})).total,1);
 const archived=await getRecord(admin,r.id);await recordAction(admin,r.id,'restore',archived.version);const active=await getRecord(admin,r.id);
 await assert.rejects(()=>recordAction(seller,r.id,'delete',active.version),{status:403});await recordAction(admin,r.id,'delete',active.version);await assert.rejects(()=>getRecord(admin,r.id),{status:404});
 assert.ok((await database().query('SELECT 1 FROM crm_activities WHERE record_id=$1',[r.id])).rowCount);
});
test('dashboard com dados e exportação respeitam escopo',async()=>{
 const totals=await dashboard(seller);assert.equal(totals.leads,1);assert.equal(totals.customers,1);assert.equal(totals.grouped.source[0].label,'Indicação');
 assert.equal((await dashboard(otherSeller)).leads,0);assert.equal((await exportRecords(seller,'customer',{city:'Contagem'})).length,1);
});
test('validação de CPF/CNPJ, datas e CSV evita valores inválidos e fórmulas',()=>{
 assert.equal(recordSchema.safeParse({name:'Teste',document:'111.111.111-11'}).success,false);
 assert.equal(recordSchema.parse({name:'Teste',average_consumption:null}).average_consumption,null);
 assert.equal(recordSchema.parse({name:'Teste',person_type:'PJ',document:'12.ABC.345/01DE-35'}).document,'12ABC34501DE35');
 assert.equal(recordSchema.safeParse({name:'Teste',person_type:'PJ',document:'12.ABC.345/01DE-34'}).success,false);
 assert.equal(recordSchema.safeParse({name:'Teste',expected_close:'2026-02-31'}).success,false);
 assert.equal(csvCell('=HYPERLINK("x")'),'"\'=HYPERLINK(""x"")"');assert.equal(csvCell('linha;"x"'),'"linha;""x"""');
});

let operation:Opportunity;let operationLead:CommercialRecord;
test('operação comercial inicia com indicadores e pipeline vazios',async()=>{assert.equal((await indicators(admin)).open_count,0);assert.equal((await pipeline(admin,{})).total,0);});
test('lead gera oportunidade sem duplicar cliente e preserva histórico',async()=>{
 operationLead=await saveRecord(seller,'lead',{name:'Lead operação solar',phone:'(31) 98888-7766',source:'Google'});await addNote(seller,{record_id:operationLead.id,body:'Histórico anterior à oportunidade.'});
 const customers=(await listRecords(admin,'customer',{})).total;
 operation=await saveOpportunity(seller,{title:'Projeto operação solar',lead_id:operationLead.id,estimated_value:48000,probability:25,source:'Google',opened_on:'2026-09-01',expected_close:'2026-09-30'});
 assert.equal(operation.lead_id,operationLead.id);assert.equal((await getRecord(seller,operationLead.id)).status,'active');assert.equal((await listRecords(admin,'customer',{})).total,customers);
 assert.ok((await opportunityFeed(seller,operation.id,'notes')).items);assert.equal((await opportunityFeed(seller,operation.id,'notes')).total,1);
});
test('oportunidade avança de etapa com versão e histórico',async()=>{
 operation=await moveOpportunity(seller,operation.id,{stage:'qualification',version:operation.version});assert.equal(operation.stage,'qualification');assert.equal(operation.owner_id,seller.userId);
 await assert.rejects(()=>moveOpportunity(seller,operation.id,{stage:'negotiation',version:1}),{status:409});assert.ok((await opportunityFeed(seller,operation.id,'activities')).total>=3);
});
test('filtros comerciais, busca por telefone, paginação e totais respeitam o escopo',async()=>{
 assert.equal((await listOpportunities(seller,{q:'(31) 98888-7766',owner:seller.userId,stage:'qualification',source:'Google',from:'2026-09-01',to:'2026-09-30'})).total,1);
 assert.equal((await listOpportunities(seller,{page:2,pageSize:1})).items.length,0);assert.equal((await pipeline(seller,{})).value_open,48000);assert.equal((await listOpportunities(otherSeller,{})).total,0);assert.equal((await listOpportunities(otherTenant,{})).total,0);
});
test('permissões de oportunidade bloqueiam IDOR, tenant alheio e vínculos inválidos',async()=>{
 await assert.rejects(()=>getOpportunity(otherSeller,operation.id),{status:404});await assert.rejects(()=>getOpportunity(otherTenant,operation.id),{status:404});
 await assert.rejects(()=>saveOpportunity(otherTenant,{title:'Tentativa cruzada',lead_id:operationLead.id}),{status:404});
 await assert.rejects(()=>saveOpportunity(seller,{title:'Responsável alheio',lead_id:operationLead.id,owner_id:otherSeller.userId}),{status:403});
 await assert.rejects(()=>saveOpportunity(seller,{title:'Tipo incorreto',company_id:operationLead.id}),{status:400});
 await assert.rejects(()=>addOpportunityNote(otherSeller,{opportunity_id:operation.id,body:'Não autorizado'}),{status:404});
});
test('perda exige motivo; ganho preserva valor e responsável do fechamento',async()=>{
 await assert.rejects(()=>moveOpportunity(seller,operation.id,{stage:'lost',version:operation.version}));
 operation=await moveOpportunity(seller,operation.id,{stage:'lost',loss_reason:'price',version:operation.version});assert.equal(operation.status,'lost');assert.equal(operation.loss_reason,'price');assert.ok(operation.closed_at);
 operation=await moveOpportunity(seller,operation.id,{stage:'negotiation',version:operation.version});assert.equal(operation.closed_at,null);
 operation=await moveOpportunity(seller,operation.id,{stage:'won',version:operation.version});assert.equal(operation.status,'won');assert.equal(operation.closed_value,48000);assert.ok(operation.closed_owner_name);
 const data=await indicators(seller,{from:'2026-01-01',to:'2026-12-31'});assert.equal(data.won_count,1);assert.equal(data.won_value,48000);assert.equal(data.conversion_rate,100);
});
test('cliente existente recebe oportunidade e contato vinculado validado',async()=>{
 const contact=(await recordFeed(seller,customer.id,'contacts')).items[0];const direct=await saveOpportunity(seller,{title:'Ampliação do cliente',customer_id:customer.id,contact_id:contact.id});assert.equal(direct.customer_id,customer.id);
 await assert.rejects(()=>saveOpportunity(seller,{title:'Contato fora do vínculo',lead_id:operationLead.id,contact_id:contact.id}),{status:400});
});
test('tarefas existentes são expandidas com dia inteiro, prioridade e estados',async()=>{
 let task=await saveTask(seller,{title:'Retornar proposta',opportunity_id:operation.id,due_date:'2026-10-02',priority:'high',description:'Confirmar decisão.'});assert.equal(task.due_time,'');assert.equal(task.status,'pending');
 task=await updateTaskStatus(seller,task.id,{status:'in_progress',version:task.version});assert.equal(task.status,'in_progress');
 task=await updateTaskStatus(seller,task.id,{status:'completed',version:task.version});assert.ok(task.completed_at);
 task=await updateTaskStatus(seller,task.id,{status:'cancelled',version:task.version});assert.equal(task.completed_at,null);
 assert.equal((await listTasks(seller,{opportunity_id:operation.id,from:'2026-10-02',to:'2026-10-02'})).total,1);
 await assert.rejects(()=>getTask(otherSeller,task.id),{status:404});await assert.rejects(()=>updateTaskStatus(otherTenant,task.id,{status:'completed'}),{status:404});
});
test('tarefa atribuída é visível apenas ao responsável e pode ser concluída',async()=>{
 const record=await saveRecord(admin,'lead',{name:'Cadastro gestão'});const task=await saveTask(admin,{title:'Retorno delegado',record_id:record.id,owner_id:otherSeller.userId,due_date:'2026-09-15',due_time:'10:30'});
 assert.equal((await getTask(otherSeller,task.id)).owner_id,otherSeller.userId);await updateTaskStatus(otherSeller,task.id,{status:'completed',version:task.version});await assert.rejects(()=>getTask(seller,task.id),{status:404});
});
test('follow-up usa inatividade, tempo na etapa e critério da gestão',async()=>{
 operation=await moveOpportunity(seller,operation.id,{stage:'decision',version:operation.version});await database().query("UPDATE crm_opportunities SET last_activity_at=now()-interval '20 days',stage_changed_at=now()-interval '20 days' WHERE id=$1",[operation.id]);
 await assert.rejects(()=>saveSettings(seller,{inactive_days:5}),{status:403});await saveSettings(admin,{inactive_days:10});const f=await followUp(seller);assert.equal(f.settings.inactive_days,10);assert.ok(f.inactive);assert.equal((await indicators(seller)).inactive_count,1);assert.equal((await indicators(otherSeller)).inactive_count,0);
 await addOpportunityNote(seller,{opportunity_id:operation.id,body:'Contato retomado.'});assert.equal((await indicators(seller)).inactive_count,0);
});
test('API de domínio rejeita tarefa com dois vínculos e probabilidade inválida',async()=>{
 await assert.rejects(()=>saveTask(seller,{title:'Vínculo ambíguo',record_id:operationLead.id,opportunity_id:operation.id,due_date:'2026-09-15'}));
 await assert.rejects(()=>saveOpportunity(seller,{title:'Probabilidade inválida',lead_id:operationLead.id,probability:101}));
 await assert.rejects(()=>saveOpportunity(seller,{title:'Previsão inválida',lead_id:operationLead.id,opened_on:'2026-10-01',expected_close:'2026-09-01'}));
});


test('edição comercial registra valor, prioridade, previsão e responsável',async()=>{
 const updated=await saveOpportunity(admin,{...opportunitySchema.strip().parse(operation),owner_id:otherSeller.userId,estimated_value:51000,priority:'urgent',expected_close:'2026-10-05'},operation.id);
 assert.equal(updated.owner_id,otherSeller.userId);assert.equal(updated.estimated_value,51000);assert.equal(updated.priority,'urgent');
 const history=JSON.stringify(await opportunityFeed(otherSeller,updated.id,'activities'));assert.ok(history.includes('opportunity.value'));assert.ok(history.includes('opportunity.owner'));
 await assert.rejects(()=>getOpportunity(seller,operation.id),{status:404});
});
test('DEMO fica separado da operação real e não aceita vínculo misturado',async()=>{
 const demo=await saveRecord(admin,'lead',{name:'Exemplo isolado DEMO'});await database().query('UPDATE crm_records SET is_demo=true WHERE id=$1',[demo.id]);
 const o=await saveOpportunity(admin,{title:'Pipeline DEMO',lead_id:demo.id,estimated_value:999});assert.equal(o.is_demo,true);
 assert.equal((await listOpportunities(admin,{q:'Pipeline DEMO'})).total,0);assert.equal((await listOpportunities(admin,{demo:'demo'})).total,1);assert.equal((await indicators(admin,{demo:'demo'})).pipeline_value,999);
 const converted=await recordAction(admin,demo.id,'convert',demo.version) as CommercialRecord;assert.equal((await database().query('SELECT is_demo FROM crm_records WHERE id=$1',[converted.id])).rows[0].is_demo,true);
 await assert.rejects(()=>saveOpportunity(admin,{title:'Mistura proibida',lead_id:demo.id,customer_id:customer.id}),{status:400});
});

test('unidade consumidora pertence ao cliente e respeita organização e responsável',async()=>{
 const unit=await saveEnergyUnit(seller,{customer_id:customer.id,label:'Residência principal',consumer_unit_number:'UC-100200',installation_number:'INST-20',utility:'Cemig',holder_name:customer.name,tariff_group:'B1 residencial',supply_type:'two_phase',voltage:220,service_address:'Contagem - MG'});
 assert.equal(unit.customer_id,customer.id);assert.equal(unit.utility,'Cemig');assert.equal((await listEnergyUnits(seller,customer.id)).length,1);
 await assert.rejects(()=>listEnergyUnits(otherSeller,customer.id),{status:404});await assert.rejects(()=>getEnergyUnit(otherTenant,unit.id),{status:404});
 await assert.rejects(()=>saveEnergyUnit(seller,{customer_id:customer.id,label:'Duplicada',consumer_unit_number:'UC-100200',utility:'Cemig'}),{status:409});
});

test('histórico mensal e fatura formam base futura de dimensionamento',async()=>{
 const unit=(await listEnergyUnits(seller,customer.id))[0]!;let first:Awaited<ReturnType<typeof saveConsumption>>|undefined;
 for(let index=0;index<12;index++){const date=new Date(Date.UTC(2026,7-index,1));const reference_month=`${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}`;const saved=await saveConsumption(seller,{consumer_unit_id:unit.id,reference_month,consumption_kwh:500+index*10,injected_energy_kwh:index,peak_demand_kw:null,days_billed:30,source:'bill',notes:''});if(index===0)first=saved;}
 const bill=await saveBill(seller,{consumer_unit_id:unit.id,reference_month:'2026-08',invoice_number:'FAT-2026-08',issue_date:'2026-08-05',due_date:'2026-08-15',total_amount:684.32,tariff_flag:'green',previous_reading:1000,current_reading:1500,notes:''});
 const detail=await getEnergyUnit(seller,unit.id);assert.equal(detail.summary.ready_for_sizing,true);assert.equal(detail.summary.last_12_months,12);assert.equal(detail.summary.total_kwh,6660);assert.equal(detail.bills[0].total_amount,684.32);
 await assert.rejects(()=>saveConsumption(seller,{consumer_unit_id:unit.id,reference_month:'2026-08',consumption_kwh:1}),{status:409});
 const original=first!;const updateBody={consumer_unit_id:original.consumer_unit_id,reference_month:original.reference_month,consumption_kwh:510,injected_energy_kwh:original.injected_energy_kwh,peak_demand_kw:original.peak_demand_kw,days_billed:original.days_billed,source:original.source,notes:original.notes,version:original.version};const updated=await saveConsumption(seller,updateBody,original.id);assert.equal(updated.version,2);await assert.rejects(()=>saveConsumption(seller,{...updateBody,consumption_kwh:520},original.id),{status:409});
 await assert.rejects(()=>saveBill(seller,{consumer_unit_id:unit.id,reference_month:'2026-09',issue_date:'2026-09-20',due_date:'2026-09-10',total_amount:10}),/vencimento/);
 assert.equal(bill.reference_month,'2026-08');
});

test('arquivamento da unidade preserva histórico e bloqueia novos lançamentos',async()=>{
 const unit=(await listEnergyUnits(seller,customer.id))[0]!;const archived=await setEnergyUnitStatus(seller,unit.id,'archived',unit.version);assert.equal(archived.status,'archived');assert.equal((await getEnergyUnit(seller,unit.id)).consumptions.length,12);
 await assert.rejects(()=>saveConsumption(seller,{consumer_unit_id:unit.id,reference_month:'2025-08',consumption_kwh:400}),{status:409});
 const restored=await setEnergyUnitStatus(seller,unit.id,'active',archived.version);assert.equal(restored.status,'active');
});

test('dimensionamento usa os 12 meses mais recentes e preserva a memória do cálculo',async()=>{
 const unit=(await listEnergyUnits(seller,customer.id))[0]!;const sizing=await createSolarSizing(seller,{consumer_unit_id:unit.id,solar_irradiation_daily:5,performance_ratio_percent:80,module_power_w:550,safety_margin_percent:10,notes:'Cenário inicial'});
 assert.equal(sizing.consumption_months,12);assert.equal(sizing.module_count,10);assert.equal(sizing.system_power_kwp,5.5);assert.equal(sizing.estimated_monthly_generation_kwh,660);assert.ok(Math.abs(sizing.average_consumption_kwh-555.833)<0.001);
 const second=await createSolarSizing(seller,{consumer_unit_id:unit.id,solar_irradiation_daily:5.5,performance_ratio_percent:82,module_power_w:600,safety_margin_percent:15,notes:'Cenário revisado'});const history=await listSolarSizings(seller,unit.id);assert.equal(history.length,2);assert.equal(history[0].id,second.id);assert.equal(history[1].id,sizing.id);
 await assert.rejects(()=>listSolarSizings(otherSeller,unit.id),{status:404});await assert.rejects(()=>listSolarSizings(otherTenant,unit.id),{status:404});
 const activities=await recordFeed(seller,customer.id,'activities');assert.ok(activities.items.some(item=>item.action==='solar.sizing.created'));
});

test('dimensionamento exige consumo e valida parâmetros físicos básicos',async()=>{
 const empty=await saveEnergyUnit(seller,{customer_id:customer.id,label:'Unidade sem histórico'});await assert.rejects(()=>createSolarSizing(seller,{consumer_unit_id:empty.id,solar_irradiation_daily:5,performance_ratio_percent:80,module_power_w:550,safety_margin_percent:10,notes:''}),{status:422});
 const unit=(await listEnergyUnits(seller,customer.id)).find(item=>item.label==='Residência principal')!;await assert.rejects(()=>createSolarSizing(seller,{consumer_unit_id:unit.id,solar_irradiation_daily:9,performance_ratio_percent:80,module_power_w:550,safety_margin_percent:10,notes:''}));
});

let moduleItem:Awaited<ReturnType<typeof saveEquipment>>;let inverterItem:Awaited<ReturnType<typeof saveEquipment>>;let structureItem:Awaited<ReturnType<typeof saveEquipment>>;let commercialKit:Awaited<ReturnType<typeof saveKit>>;
test('gestão cadastra módulos, inversores e componentes com histórico e RBAC',async()=>{
 moduleItem=await saveEquipment(admin,{category:'module',name:'Módulo 550 W',manufacturer:'Solar Teste',model:'ST-550',sku:'MOD-550',nominal_power_w:550,efficiency_percent:21.3,phases:null,mppt_count:null,unit:'unit',technical_notes:'Painel monocristalino.'});
 inverterItem=await saveEquipment(admin,{category:'inverter',name:'Inversor 5 kW',manufacturer:'Inverter Teste',model:'INV-5K',sku:'INV-5000',nominal_power_w:5000,efficiency_percent:98,phases:2,mppt_count:2,unit:'unit',technical_notes:'Inversor string.'});
 structureItem=await saveEquipment(admin,{category:'structure',name:'Estrutura para telhado',manufacturer:'Estruturas Teste',model:'ET-4',sku:'EST-4',nominal_power_w:null,efficiency_percent:null,phases:null,mppt_count:null,unit:'set',technical_notes:'Conjunto para quatro módulos.'});
 assert.equal((await listEquipment(seller,{category:'module'}))[0].nominal_power_w,550);assert.equal((await listEquipment(otherTenant,{})).length,0);
 await assert.rejects(()=>saveEquipment(seller,{category:'component',name:'Sem permissão'}),{status:403});await assert.rejects(()=>saveEquipment(admin,{category:'module',name:'Duplicado',sku:'MOD-550',nominal_power_w:500}),{status:409});
 assert.equal((await getEquipment(admin,moduleItem.id)).history.length,1);
});

test('kit calcula composição, potência e mantém versões das alterações',async()=>{
 commercialKit=await saveKit(admin,{name:'Kit residencial 4,4 kWp',code:'KIT-44',description:'Kit comercial de referência.',items:[{equipment_id:moduleItem.id,quantity:8},{equipment_id:inverterItem.id,quantity:1},{equipment_id:structureItem.id,quantity:2}]});
 assert.equal(commercialKit.module_count,8);assert.equal(commercialKit.dc_power_kwp,4.4);assert.equal(commercialKit.inverter_power_kw,5);assert.equal((await listKits(seller,{})).length,1);
 await assert.rejects(()=>saveKit(seller,{name:'Kit sem permissão',items:[{equipment_id:moduleItem.id,quantity:1}]}),{status:403});
 await assert.rejects(()=>saveKit(admin,{name:'Kit sem módulo',items:[{equipment_id:structureItem.id,quantity:1}]}),/ao menos um módulo/);
});

test('kit vinculado ao dimensionamento calcula quantidade e preserva snapshot',async()=>{
 const unit=(await listEnergyUnits(seller,customer.id)).find(item=>item.label==='Residência principal')!;const sizing=(await listSolarSizings(seller,unit.id))[0];const selected=await selectKitForSizing(seller,{sizing_id:sizing.id,kit_id:commercialKit.id});
 assert.equal(selected.kit_quantity,2);assert.equal(selected.module_count,16);assert.equal(selected.dc_power_kwp,8.8);assert.equal(selected.inverter_power_kw,10);
 await assert.rejects(()=>listKitSelections(otherSeller,sizing.id),{status:404});await assert.rejects(()=>selectKitForSizing(otherTenant,{sizing_id:sizing.id,kit_id:commercialKit.id}),{status:404});
 moduleItem=await saveEquipment(admin,{category:'module',name:moduleItem.name,manufacturer:moduleItem.manufacturer,model:moduleItem.model,sku:moduleItem.sku,nominal_power_w:600,efficiency_percent:22,phases:null,mppt_count:null,unit:'unit',technical_notes:moduleItem.technical_notes,version:moduleItem.version},moduleItem.id);
 assert.equal((await getEquipment(admin,moduleItem.id)).history.length,2);assert.equal((await getKit(admin,commercialKit.id)).dc_power_kwp,4.8);assert.equal((await listKitSelections(seller,sizing.id))[0].dc_power_kwp,8.8);
 commercialKit=await saveKit(admin,{name:'Kit residencial 6 kWp',code:commercialKit.code,description:commercialKit.description,items:[{equipment_id:moduleItem.id,quantity:10},{equipment_id:inverterItem.id,quantity:1},{equipment_id:structureItem.id,quantity:3}],version:commercialKit.version},commercialKit.id);assert.equal(commercialKit.dc_power_kwp,6);assert.equal((await getKit(admin,commercialKit.id)).history.length,2);
 await assert.rejects(()=>setEquipmentStatus(admin,structureItem.id,'archived',structureItem.version),{status:409});commercialKit=await setKitStatus(admin,commercialKit.id,'archived',commercialKit.version);assert.equal((await getKit(admin,commercialKit.id)).history.length,3);const archived=await setEquipmentStatus(admin,structureItem.id,'archived',structureItem.version);assert.equal(archived.status,'archived');assert.equal((await getEquipment(admin,structureItem.id)).history.length,2);
});

test('PDF manual permanece vinculado ao cliente e à oportunidade com histórico e integridade',async()=>{
 const opportunity=await saveOpportunity(seller,{title:'Orçamento fotovoltaico manual',customer_id:customer.id,estimated_value:32990,opened_on:'2026-09-15'});
 const pdf=Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF');
 let document=await createDocument(seller,{customer_id:customer.id,opportunity_id:opportunity.id,name:'Orçamento residencial',budget_value:32990,valid_until:'2026-10-15',notes:'Condição comercial inicial.'},{name:'orcamento-peclat.pdf',type:'application/pdf',bytes:pdf});
 assert.equal(document.status,'draft');assert.equal(document.customer_id,customer.id);assert.equal(document.opportunity_id,opportunity.id);assert.equal('storage_key' in document,false);assert.equal((await listDocuments(seller,{customer_id:customer.id})).some(item=>item.id===document.id),true);assert.equal((await listDocuments(seller,{opportunity_id:opportunity.id}))[0].id,document.id);
 const stored=await getDocumentFile(seller,document.id);assert.deepEqual(stored.bytes,pdf);await assert.rejects(()=>getDocumentFile(otherSeller,document.id),{status:404});await assert.rejects(()=>getDocumentFile(otherTenant,document.id),{status:404});
 document=await updateDocument(seller,document.id,{name:'Orçamento residencial revisado',budget_value:31990,valid_until:'2026-10-30',notes:'Desconto comercial.',version:document.version});assert.equal(document.version,2);await assert.rejects(()=>updateDocument(seller,document.id,{name:'Conflito',budget_value:1,valid_until:'2026-10-30',notes:'',version:1}),{status:409});
 document=await setDocumentStatus(seller,document.id,'sent',document.version);document=await setDocumentStatus(seller,document.id,'accepted',document.version);const detail=await getDocument(seller,document.id);assert.equal(detail.history.length,4);assert.deepEqual(detail.history.map(item=>item.action),['status_changed','status_changed','updated','created']);assert.equal(detail.history.at(-1)!.snapshot.budget_value,32990);
});

test('upload rejeita arquivo falso e vínculos incompatíveis',async()=>{
 const opportunity=await saveOpportunity(seller,{title:'Outra oportunidade de cliente',customer_id:customer.id});const otherCustomer=await saveRecord(seller,'customer',{name:'Cliente sem vínculo documental'});const fake=Buffer.from('conteúdo executável');
 await assert.rejects(()=>createDocument(seller,{customer_id:customer.id,opportunity_id:opportunity.id,name:'Arquivo falso',budget_value:1,valid_until:'2026-10-01',notes:''},{name:'falso.pdf',type:'application/pdf',bytes:fake}),{status:415});
 await assert.rejects(()=>createDocument(seller,{customer_id:otherCustomer.id,opportunity_id:opportunity.id,name:'Vínculo incorreto',budget_value:1,valid_until:'2026-10-01',notes:''},{name:'valido.pdf',type:'application/pdf',bytes:Buffer.from('%PDF-1.4\n%%EOF')}),{status:400});
});

test('envio por e-mail anexa o PDF e registra destinatário nos históricos',async()=>{
 const opportunity=await saveOpportunity(seller,{title:'Envio de orçamento por e-mail',customer_id:customer.id});const pdf=Buffer.from('%PDF-1.4\nemail attachment\n%%EOF');const document=await createDocument(seller,{customer_id:customer.id,opportunity_id:opportunity.id,name:'Orçamento para envio',budget_value:24500,valid_until:'2026-11-15',notes:''},{name:'proposta-manual.pdf',type:'application/pdf',bytes:pdf});
 let captured:Parameters<DocumentMailProvider['sendDocument']>[0]|undefined;const mail:DocumentMailProvider={async sendDocument(input){captured=input;return {messageId:'message-test-1'};}};const sent=await sendDocumentEmail(seller,document.id,{recipient:'CLIENTE@EXAMPLE.COM',subject:'Seu orçamento Peclat Solar',message:'Olá, segue o orçamento solicitado.'},mail);
 assert.equal(captured?.to,'cliente@example.com');assert.equal(captured?.filename,'proposta-manual.pdf');assert.deepEqual(Buffer.from(captured!.content),pdf);assert.equal(sent.document.status,'sent');assert.equal(sent.email.recipient,'cliente@example.com');assert.equal(sent.email.document_name,'Orçamento para envio');
 const detail=await getDocument(seller,document.id);assert.equal(detail.emails.length,1);assert.equal(detail.emails[0].provider_message_id,'message-test-1');const customerActivities=await recordFeed(seller,customer.id,'activities') as {items:{action:string}[]};assert.ok(customerActivities.items.some(item=>item.action==='document.email_sent'));const opportunityActivities=await opportunityFeed(seller,opportunity.id,'activities') as {items:{action:string}[]};assert.ok(opportunityActivities.items.some(item=>item.action==='document.email_sent'));
 await assert.rejects(()=>sendDocumentEmail(otherSeller,document.id,{recipient:'x@example.com',subject:'Bloqueado',message:'Não enviar.'},mail),{status:404});await assert.rejects(()=>sendDocumentEmail(seller,document.id,{recipient:'inválido',subject:'Teste',message:'Teste'},mail));
 const failing:DocumentMailProvider={async sendDocument(){throw new Error('smtp offline');}};await assert.rejects(()=>sendDocumentEmail(seller,document.id,{recipient:'cliente@example.com',subject:'Nova tentativa',message:'Mensagem.'},failing),{status:502});assert.equal((await getDocument(seller,document.id)).emails.length,1);
 const previous=process.env.SMTP_HOST;delete process.env.SMTP_HOST;assert.throws(()=>smtpProvider(),MailConfigurationError);if(previous)process.env.SMTP_HOST=previous;
});
