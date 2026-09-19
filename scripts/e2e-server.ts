import EmbeddedPostgres from './embedded-db';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
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
// Contas exclusivas da distribuição: preservam os cenários anteriores e seus limites de login.
const distributionUsers=[
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
async function stop(){if(stopping)return;stopping=true;if(app.exitCode===null&&app.signalCode===null){const closed=once(app,'close');app.kill();await closed;}await new Promise<void>(done=>smtp.close(()=>done()));await database().end();await db.stop();process.exit(0);}
process.once('SIGTERM',stop);process.once('SIGINT',stop);app.once('exit',stop);
