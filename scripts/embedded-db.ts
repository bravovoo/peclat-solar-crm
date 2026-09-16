import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Client } from 'pg';

type PostgresOptions = {
  databaseDir: string;
  port: number;
  user: string;
  password: string;
  authMethod: 'scram-sha-256' | 'password' | 'md5';
  persistent: boolean;
  initdbFlags: string[];
  postgresFlags: string[];
  createPostgresUser: boolean;
  onLog: (message: string) => void;
  onError: (messageOrError: unknown) => void;
};

type EmbeddedPostgresInstance = {
  options: PostgresOptions;
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  getPgClient(database?: string, host?: string): Client;
  createDatabase(name: string): Promise<void>;
  dropDatabase(name: string): Promise<void>;
};

type EmbeddedPostgresConstructor = new (options?: Partial<PostgresOptions>) => EmbeddedPostgresInstance;

const requireFromLocalRuntime=createRequire(new URL('../tools/local-postgres/package.json',import.meta.url));
let embeddedPostgresPath:string;
try {
  embeddedPostgresPath=requireFromLocalRuntime.resolve('embedded-postgres');
} catch {
  throw new Error('Runtime do PostgreSQL local ausente. Execute npm run local:deps.');
}
const EmbeddedPostgres=(await import(pathToFileURL(embeddedPostgresPath).href)).default as EmbeddedPostgresConstructor;
const execFileAsync=promisify(execFile);
// O encerramento forçado do pacote pode deixar workers órfãos no Windows.
// pg_ctl faz o shutdown coordenado e preserva a consistência dos arquivos.
export default class LocalPostgres extends EmbeddedPostgres {
  private running=false;
  override async initialise(){this.options.initdbFlags=[...this.options.initdbFlags,'--encoding=UTF8','--locale=C'];await super.initialise();}
  override async start(){await super.start();this.running=true;}
  override async stop(){
    if(!this.running)return;
    this.running=false;
    try{
      const requireFromPackage=createRequire(embeddedPostgresPath);
      const platform=process.platform==='win32'?'windows':process.platform;
      const modulePath=requireFromPackage.resolve(`@embedded-postgres/${platform}-${process.arch}`);
      const binaries=await import(pathToFileURL(modulePath).href) as {pg_ctl:string};
      await execFileAsync(binaries.pg_ctl,['-D',this.options.databaseDir,'stop','-m','fast','-w','-t','15'],{windowsHide:true,timeout:20000});
    }catch(error){this.running=true;throw error;}
  }
}
