import {saveOpportunity,saveTask} from '../src/modules/commercial/repository';
import {today} from '../src/modules/commercial/domain';
import { loadEnvFile } from 'node:process';
import { database } from '../src/server/db';
import { login,logout,sessionActor } from '../src/modules/auth/service';
import { saveRecord,mutateTag,crmOptions,addContact,addNote } from '../src/modules/crm/repository';
try{loadEnvFile('.env');}catch{throw new Error('Crie o ambiente antes do seed de demonstração.');}
if(process.env.SEED_DEMO!=='true')throw new Error('Defina SEED_DEMO=true explicitamente. Este comando cria somente dados fictícios de desenvolvimento.');
if(process.env.NODE_ENV==='production')throw new Error('Seed de demonstração bloqueado em produção.');
let token:string|undefined;
try{
 token=await login({organization:'peclat-solar',email:process.env.SEED_ADMIN_EMAIL,password:process.env.SEED_ADMIN_PASSWORD});const actor=(await sessionActor(token))!;
 for(const name of ['Residencial','Comercial','Industrial','Financiamento','Bateria','Indicação','Facebook','Instagram','Google','WhatsApp']){if(!(await crmOptions(actor)).tags.some(t=>t.name===name))await mutateTag(actor,{name,color:'#219878'});}
 const tags=(await crmOptions(actor)).tags;
 for(const [kind,name,source,city,consumption,tag] of [['lead','Residência Horizonte · DEMO','Indicação','Belo Horizonte',650,'Residencial'],['lead','Projeto Boa Vista · DEMO','Instagram','Contagem',1100,'Bateria'],['customer','Cliente Jardim Solar · DEMO','Manual','Betim',420,'Residencial'],['company','Comércio Aurora · DEMO','Manual','Belo Horizonte',0,'Comercial']] as const){
  const exists=await database().query('SELECT 1 FROM crm_records WHERE organization_id=$1 AND name=$2 AND kind=$3',[actor.organizationId,name,kind]);if(exists.rowCount)continue;
  const record=await saveRecord(actor,kind,{name,person_type:kind==='company'?'PJ':'PF',source,city,state:'MG',average_consumption:consumption||null,potential_value:kind==='lead'?25000:0,stage:name.includes('Boa Vista')?'contact':'new',observations:'[DEMO] Cadastro fictício de desenvolvimento. Não representa uma pessoa ou empresa real.',tag_ids:tags.filter(t=>t.name===tag).map(t=>t.id)});
  await addContact(actor,{record_id:record.id,name:'Contato de demonstração',job_title:'Responsável pelo projeto',is_primary:true});
  await addNote(actor,{record_id:record.id,body:'[DEMO] Aguardando levantamento das necessidades de energia solar.'});
 }

 await database().query("UPDATE crm_records SET is_demo=true WHERE organization_id=$1 AND observations LIKE '[DEMO]%' AND name IN ('Residência Horizonte · DEMO','Projeto Boa Vista · DEMO','Cliente Jardim Solar · DEMO','Comércio Aurora · DEMO')",[actor.organizationId]);
 for(const [title,recordName,stage,value] of [['Projeto Horizonte · DEMO','Residência Horizonte · DEMO','qualification',25000],['Ampliação Jardim Solar · DEMO','Cliente Jardim Solar · DEMO','proposal_sent',12000]] as const){
  if((await database().query('SELECT 1 FROM crm_opportunities WHERE organization_id=$1 AND title=$2 AND is_demo',[actor.organizationId,title])).rowCount)continue;
  const parent=(await database().query('SELECT id,kind FROM crm_records WHERE organization_id=$1 AND name=$2 AND is_demo',[actor.organizationId,recordName])).rows[0];if(!parent)continue;
  const due=new Date(today()+'T12:00:00Z');due.setUTCDate(due.getUTCDate()+5);
  const opportunity=await saveOpportunity(actor,{title,[parent.kind==='lead'?'lead_id':'customer_id']:parent.id,stage,estimated_value:value,probability:50,opened_on:today(),expected_close:due.toISOString().slice(0,10),observations:'[DEMO] Exemplo fictício da operação comercial.'});
  await saveTask(actor,{title:'Retorno comercial · DEMO',opportunity_id:opportunity.id,due_date:today(),description:'[DEMO] Contato fictício para validar a agenda.'});
 }
 console.log('Dados de demonstração criados. Cadastros existentes foram preservados.');
}finally{await logout(token);await database().end();}
