import EmbeddedPostgres from './embedded-db';
import { mkdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
try { loadEnvFile('.env'); } catch { throw new Error('Crie .env antes de iniciar o banco local.'); }
const url=new URL(process.env.DATABASE_URL!);
if (!['localhost','127.0.0.1'].includes(url.hostname)) throw new Error('db:local aceita somente endereço local.');
const dir=resolve('.local/postgres');
await mkdir(dir,{recursive:true});
const server=new EmbeddedPostgres({databaseDir:dir,user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),port:Number(url.port||5432),persistent:true,authMethod:'scram-sha-256',postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
try{await access(resolve(dir,'PG_VERSION'));}catch{await server.initialise();}
await server.start();
const client=server.getPgClient('postgres','127.0.0.1');await client.connect();
const dbName=url.pathname.slice(1);
if(!/^[a-z][a-z0-9_]{0,62}$/.test(dbName))throw new Error('Nome de banco local inválido.');
if(!(await client.query('SELECT 1 FROM pg_database WHERE datname=$1',[dbName])).rowCount)await client.query(`CREATE DATABASE "${dbName}"`);
await client.end();
console.log(`PostgreSQL local disponível em 127.0.0.1:${url.port||5432}. Ctrl+C encerra sem apagar dados.`);
await new Promise<void>(resolveStop=>{process.once('SIGINT',resolveStop);process.once('SIGTERM',resolveStop);});
await server.stop();
