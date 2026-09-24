import EmbeddedPostgres from './embedded-db';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import {createServer as createHttpServer} from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { migrate } from './migrate';
import { seed } from './seed';
import { database } from '../src/server/db';
import { hashPassword } from '../src/modules/auth/crypto';
const port=await new Promise<number>(done=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const a=s.address();if(a&&typeof a==='object')s.close(()=>done(a.port));});});
await mkdir(resolve('.local/tests'),{recursive:true});
const dir=await mkdtemp(resolve('.local/tests/e2e-'));
process.env.DOCUMENT_STORAGE_PROVIDER='local';process.env.DOCUMENT_STORAGE_DIR=resolve(dir,'documents');
const db=new EmbeddedPostgres({databaseDir:dir,user:'e2e',password:'e2e_database_only',port,persistent:true,authMethod:'scram-sha-256',postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
await db.initialise();await db.start();await db.createDatabase('peclat_e2e');
process.env.DATABASE_URL=`postgresql://e2e:e2e_database_only@127.0.0.1:${port}/peclat_e2e`;
process.env.APP_URL='http://localhost:3100';process.env.SEED_ADMIN_EMAIL='admin@e2e.local';process.env.SEED_ADMIN_PASSWORD='Peclat teste seguro 2026';process.env.SEED_ADMIN_NAME='Admin de teste';
process.env.AI_TEST_MODE='true';
const metaTemplates=[{id:'template-e2e',name:'retomar_atendimento',language:'pt_BR',category:'UTILITY',status:'APPROVED',components:[{type:'BODY',text:'Olá {{1}}, podemos continuar seu atendimento?'}]}];
const meta=createHttpServer((request,response)=>{
 response.setHeader('content-type','application/json');const path=request.url??'';
 if(request.method==='GET'&&path.includes('/message_templates'))response.end(JSON.stringify({data:metaTemplates}));
 else if(request.method==='POST'&&path.includes('/message_templates')){const chunks:Buffer[]=[];request.on('data',(chunk:Buffer)=>chunks.push(chunk));request.on('end',()=>{const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));const item={id:`template-e2e-${metaTemplates.length+1}`,name:body.name,language:body.language,category:body.category,status:'PENDING',components:body.components};metaTemplates.push(item);response.end(JSON.stringify({id:item.id,status:item.status,category:item.category}));});}
 else if(request.method==='GET'&&/\/v99\.0\/e2e-(audio|image|document)(?:\?|$)/.test(path)){const kind=path.match(/e2e-(audio|image|document)/)?.[1],address=meta.address();if(!address||typeof address==='string'){response.statusCode=500;response.end();return;}response.end(JSON.stringify({url:`http://127.0.0.1:${address.port}/media-bytes/${kind}`,mime_type:kind==='audio'?'audio/ogg':kind==='image'?'image/png':'application/pdf',file_size:kind==='audio'?8:kind==='image'?68:12}));}
 else if(request.method==='GET'&&path.startsWith('/media-bytes/')){const kind=path.split('/').at(-1),bytes=kind==='audio'?Buffer.from('OggSfake'):kind==='image'?Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL1GQAAAABJRU5ErkJggg==','base64'):Buffer.from('%PDF-1.4\n%%EOF');response.setHeader('content-type',kind==='audio'?'audio/ogg':kind==='image'?'image/png':'application/pdf');response.setHeader('accept-ranges','bytes');const range=request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);if(range){const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),bytes.length-1):bytes.length-1;response.statusCode=206;response.setHeader('content-range',`bytes ${start}-${end}/${bytes.length}`);response.end(bytes.subarray(start,end+1));}else response.end(bytes);}
 else if(request.method==='POST'&&path.endsWith('/media')){const chunks:Buffer[]=[];request.on('data',(chunk:Buffer)=>chunks.push(chunk));request.on('end',()=>response.end(JSON.stringify({id:Buffer.concat(chunks).includes(Buffer.from('application/pdf'))?'e2e-document':'e2e-image'})));}
 else if(request.method==='POST'&&path.endsWith('/messages')){request.resume();response.end(JSON.stringify({messages:[{id:`wamid.e2e.outbound.${Date.now()}`}]}));}
 else{response.statusCode=404;response.end(JSON.stringify({error:{message:'not found'}}));}
});
const metaPort=await new Promise<number>(done=>meta.listen(0,'127.0.0.1',()=>{const address=meta.address();if(address&&typeof address==='object')done(address.port);}));process.env.WHATSAPP_ACCESS_TOKEN='e2e-fake-token';process.env.WHATSAPP_APP_SECRET='e2e-fake-app-secret';process.env.WHATSAPP_META_TEST_MODE='true';process.env.WHATSAPP_GRAPH_API_BASE_URL=`http://127.0.0.1:${metaPort}`;
const smtp=createServer(socket=>{socket.setEncoding('utf8');socket.write('220 localhost ESMTP\r\n');let buffer='',readingData=false;function process(){if(readingData){const end=buffer.indexOf('\r\n.\r\n');if(end<0)return;buffer=buffer.slice(end+5);readingData=false;socket.write('250 2.0.0 queued\r\n');}let newline;while((newline=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,newline);buffer=buffer.slice(newline+2);const command=line.toUpperCase();if(command.startsWith('EHLO'))socket.write('250-localhost\r\n250 SIZE 15728640\r\n');else if(command.startsWith('HELO')||command.startsWith('MAIL FROM')||command.startsWith('RCPT TO')||command==='RSET'||command==='NOOP')socket.write('250 2.0.0 ok\r\n');else if(command==='DATA'){readingData=true;socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');return;}else if(command==='QUIT'){socket.write('221 2.0.0 bye\r\n');socket.end();return;}else socket.write('250 2.0.0 ok\r\n');}}socket.on('data',chunk=>{buffer+=chunk;process();});});
const smtpPort=await new Promise<number>(done=>smtp.listen(0,'127.0.0.1',()=>{const address=smtp.address();if(address&&typeof address==='object')done(address.port);}));process.env.SMTP_HOST='127.0.0.1';process.env.SMTP_PORT=String(smtpPort);
await migrate();await seed();
const hash=await hashPassword('Peclat teste seguro 2026');
const user=(await database().query("INSERT INTO users(email,name,password_hash) VALUES ('seller@e2e.local','Vendedor de teste',$1) RETURNING id",[hash])).rows[0];
await database().query("INSERT INTO memberships(organization_id,user_id,role_code) SELECT id,$1,'seller' FROM organizations WHERE slug='peclat-solar'",[user.id]);
const commercialManager=(await database().query("INSERT INTO users(email,name,password_hash) VALUES ('manager@e2e.local','Gerente comercial de teste',$1) RETURNING id",[hash])).rows[0];
await database().query("INSERT INTO memberships(organization_id,user_id,role_code) SELECT id,$1,'manager' FROM organizations WHERE slug='peclat-solar'",[commercialManager.id]);
const documentUser=(await database().query("INSERT INTO users(email,name,password_hash) VALUES ('documents@e2e.local','Consultor de documentos',$1) RETURNING id",[hash])).rows[0];
await database().query("INSERT INTO memberships(organization_id,user_id,role_code) SELECT id,$1,'seller' FROM organizations WHERE slug='peclat-solar'",[documentUser.id]);
const contractUser=(await database().query("INSERT INTO users(email,name,password_hash) VALUES ('contracts@e2e.local','Gestor de contratos',$1) RETURNING id",[hash])).rows[0];
await database().query("INSERT INTO memberships(organization_id,user_id,role_code) SELECT id,$1,'admin' FROM organizations WHERE slug='peclat-solar'",[contractUser.id]);
const whatsappUser=(await database().query("INSERT INTO users(email,name,password_hash) VALUES ('whatsapp@e2e.local','Admin WhatsApp E2E',$1) RETURNING id",[hash])).rows[0];
await database().query("INSERT INTO memberships(organization_id,user_id,role_code) SELECT id,$1,'admin' FROM organizations WHERE slug='peclat-solar'",[whatsappUser.id]);
const automationUser=(await database().query("INSERT INTO users(email,name,password_hash) VALUES ('automations@e2e.local','Admin Automações E2E',$1) RETURNING id",[hash])).rows[0];
await database().query("INSERT INTO memberships(organization_id,user_id,role_code) SELECT id,$1,'admin' FROM organizations WHERE slug='peclat-solar'",[automationUser.id]);
const monitoringUser=(await database().query("INSERT INTO users(email,name,password_hash) VALUES ('monitoring@e2e.local','Admin Monitoramento E2E',$1) RETURNING id",[hash])).rows[0];
await database().query("INSERT INTO memberships(organization_id,user_id,role_code) SELECT id,$1,'admin' FROM organizations WHERE slug='peclat-solar'",[monitoringUser.id]);
const whatsappOrganization=(await database().query("SELECT id FROM organizations WHERE slug='peclat-solar'")).rows[0].id;
await database().query("INSERT INTO ai_assistant_settings(organization_id,enabled,provider,model,context_message_limit,max_requests_per_hour,updated_by) VALUES ($1,true,'openai','fake-commercial-v1',40,60,$2)",[whatsappOrganization,whatsappUser.id]);
const whatsappCustomer=(await database().query("INSERT INTO crm_records(organization_id,kind,owner_id,name,whatsapp) VALUES ($1,'customer',$2,'Cliente Inbox E2E','5531991112233') RETURNING id",[whatsappOrganization,whatsappUser.id])).rows[0].id;
await database().query("INSERT INTO crm_tags(organization_id,name,color) VALUES ($1,'Residencial E2E','#195ca0')",[whatsappOrganization]);
await database().query("INSERT INTO crm_records(organization_id,kind,owner_id,name,whatsapp) VALUES ($1,'customer',$2,'Cliente duplicidade E2E','5531983334455')",[whatsappOrganization,whatsappUser.id]);
await database().query(`INSERT INTO whatsapp_integrations(organization_id,status,webhook_status,last_event_at,last_event_type,account_name,phone_number_id,business_account_id,display_phone_number,api_version,created_by,updated_by)
 VALUES ($1,'connected','receiving',now(),'messages.text','Peclat Solar E2E','100000000001','200000000001','+55 31 99999-1234','v99.0',$2,$2)`,[whatsappOrganization,whatsappUser.id]);
const linkedConversation=(await database().query(`INSERT INTO whatsapp_conversations(organization_id,external_wa_id,phone_e164,profile_name,last_message_preview,last_message_type,last_message_at,last_inbound_at,unread_count,record_id,link_status,link_source)
 VALUES ($1,'5531991112233','+5531991112233','Cliente Inbox','Preciso acompanhar meu projeto','text',now(),now(),2,$2,'identified','automatic') RETURNING id`,[whatsappOrganization,whatsappCustomer])).rows[0].id;
const unlinkedConversation=(await database().query(`INSERT INTO whatsapp_conversations(organization_id,external_wa_id,phone_e164,profile_name,last_message_preview,last_message_type,last_message_at,last_inbound_at,unread_count,link_status,link_source)
 VALUES ($1,'5531982223344','+5531982223344','Novo contato','Quero falar com a equipe','text',now()-interval '25 hours',now()-interval '25 hours',1,'unidentified','none') RETURNING id`,[whatsappOrganization])).rows[0].id;
const duplicateConversation=(await database().query(`INSERT INTO whatsapp_conversations(organization_id,external_wa_id,phone_e164,profile_name,last_message_preview,last_message_type,last_message_at,last_inbound_at,unread_count,link_status,link_source)
 VALUES ($1,'5531983334455','+5531983334455','Cadastro duplicado','Telefone já cadastrado','text',now()-interval '26 hours',now()-interval '26 hours',1,'unidentified','none') RETURNING id`,[whatsappOrganization])).rows[0].id;
await database().query(`INSERT INTO whatsapp_messages(organization_id,conversation_id,meta_message_id,message_type,text_body,sender_wa_id,meta_timestamp,processing_status) VALUES
 ($1,$2,'wamid.e2e.linked.1','text','Olá, equipe Peclat!','5531991112233',now()-interval '2 minutes','processed'),
 ($1,$2,'wamid.e2e.linked.2','text','Preciso acompanhar meu projeto','5531991112233',now(),'processed'),
 ($1,$3,'wamid.e2e.unlinked.1','text','Quero falar com a equipe','5531982223344',now()-interval '25 hours','processed'),
 ($1,$4,'wamid.e2e.duplicate.1','text','Telefone já cadastrado','5531983334455',now()-interval '26 hours','processed')`,[whatsappOrganization,linkedConversation,unlinkedConversation,duplicateConversation]);
await database().query(`INSERT INTO whatsapp_messages(organization_id,conversation_id,meta_message_id,message_type,text_body,sender_wa_id,media_id,mime_type,filename,caption,meta_timestamp,processing_status) VALUES
 ($1,$2,'wamid.e2e.media.audio','audio','Áudio recebido','5531991112233','e2e-audio','audio/ogg','nota.ogg','',now()-interval '90 seconds','processed'),
 ($1,$2,'wamid.e2e.media.image','image','Imagem recebida','5531991112233','e2e-image','image/png','painel.png','Painel instalado',now()-interval '80 seconds','processed'),
 ($1,$2,'wamid.e2e.media.document','document','Documento recebido','5531991112233','e2e-document','application/pdf','fatura.pdf','',now()-interval '70 seconds','processed'),
 ($1,$2,'wamid.e2e.media.expired','image','Imagem expirada','5531991112233','e2e-expired','image/png','antiga.png','',now()-interval '60 seconds','processed')`,[whatsappOrganization,linkedConversation]);
await database().query(`INSERT INTO whatsapp_messages(organization_id,conversation_id,meta_message_id,message_type,text_body,sender_wa_id,meta_timestamp,processing_status)
 SELECT $1,$2,'wamid.e2e.history.'||item,'text','Mensagem histórica de teste '||item,'5531991112233',now()-interval '130 minutes'+item*interval '1 minute','processed'
 FROM generate_series(1,110) item`,[whatsappOrganization,linkedConversation]);
await database().query(`INSERT INTO whatsapp_conversations(organization_id,external_wa_id,phone_e164,profile_name,last_message_preview,last_message_type,last_message_at,last_inbound_at,unread_count,link_status,link_source)
 SELECT $1,'553197'||lpad(item::text,8,'0'),'+553197'||lpad(item::text,8,'0'),'Contato de teste '||item,'Conversa para validar a rolagem da lista','text',now()-(30+item)*interval '1 hour',now()-(30+item)*interval '1 hour',0,'unidentified','none'
 FROM generate_series(1,28) item`,[whatsappOrganization]);
// Contas exclusivas da distribuição: preservam os cenários anteriores e seus limites de login.
const distributionUsers=[
  ['theme-admin','Admin tema E2E','admin',true],
  ['distribution-admin','Admin distribuição','admin',true],
  ['scope-manager','Gerente carteira E2E','manager',true],
  ['scope-a','Vendedor carteira A','seller',true],
  ['scope-b','Vendedor carteira B','seller',true],
  ['scope-outside','Vendedor fora da equipe','seller',true],
  ['assignment-manager','Gerente distribuição E2E','manager',true],
  ['assignment-a','Vendedor distribuição A','seller',true],
  ['assignment-b','Vendedor distribuição B','seller',true],
  ['assignment-inactive','Vendedor distribuição inativo','seller',false],
  ['goals-admin','Admin metas E2E','admin',true],
  ['goals-manager','Gerente metas E2E','manager',true],
  ['goals-a','Vendedor metas A','seller',true],
  ['goals-b','Vendedor metas B','seller',true],
  ['goals-outside','Vendedor metas externo','seller',true],
] as const;
for(const [email,name,role,active] of distributionUsers){
  const person=(await database().query('INSERT INTO users(email,name,password_hash,active) VALUES ($1,$2,$3,$4) RETURNING id',[`${email}@e2e.local`,name,hash,active])).rows[0];
  await database().query("INSERT INTO memberships(organization_id,user_id,role_code) SELECT id,$1,$2 FROM organizations WHERE slug='peclat-solar'",[person.id,role]);
}
const app=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','3100'],{stdio:'inherit',env:process.env,windowsHide:true});
let stopping=false;
async function stop(){if(stopping)return;stopping=true;if(app.exitCode===null&&app.signalCode===null){const closed=once(app,'close');app.kill();await closed;}await Promise.all([new Promise<void>(done=>smtp.close(()=>done())),new Promise<void>(done=>meta.close(()=>done()))]);await database().end();await db.stop();process.exit(0);}
process.once('SIGTERM',stop);process.once('SIGINT',stop);app.once('exit',stop);
