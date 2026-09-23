import {withDatabaseConnectionString} from './src/server/db';
import {runAutomationScheduler} from './src/modules/automations/engine';
import {processMetaWebhookBatches} from './src/modules/whatsapp/webhook';
import {cleanupExpiredOperationalData,processStorageDeletionJobs} from './src/modules/operations/maintenance';
// O artefato é criado pelo OpenNext antes do bundle do Wrangler.
// @ts-expect-error módulo gerado durante pnpm run cloudflare:build
import openNextWorker,{BucketCachePurge} from './.open-next/worker.js';

type WorkerEnv={HYPERDRIVE?:{connectionString:string}};
type ExecutionContextLike={waitUntil(promise:Promise<unknown>):void};

export {BucketCachePurge};
const automationWorker={
 fetch(request:Request,env:WorkerEnv,context:ExecutionContextLike){return openNextWorker.fetch(request,env,context);},
 scheduled(_controller:unknown,env:WorkerEnv,context:ExecutionContextLike){
  const connectionString=env.HYPERDRIVE?.connectionString;
  if(!connectionString){console.error('automation_scheduler_unavailable',{reason:'hyperdrive_binding_missing'});return;}
  context.waitUntil(withDatabaseConnectionString(connectionString,async()=>{try{await processMetaWebhookBatches(50);await processStorageDeletionJobs(50);await cleanupExpiredOperationalData();await runAutomationScheduler();}catch(error){console.error('operational_scheduler_failed',{type:error instanceof Error?error.name:'unknown'});throw error;}}));
 },
};
export default automationWorker;
