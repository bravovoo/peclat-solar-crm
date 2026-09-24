import {withDatabaseConnectionString} from './src/server/db';
import {runAutomationScheduler} from './src/modules/automations/engine';
import {processMetaWebhookBatches} from './src/modules/whatsapp/webhook';
import {cleanupExpiredOperationalData,processStorageDeletionJobs} from './src/modules/operations/maintenance';
import {runOperationalMonitoring} from './src/modules/operations/monitoring';
import {processOperationalAlertDeliveries} from './src/modules/operations/notifications';
import {runLeadRecoveryScheduler} from './src/modules/lead-recovery/engine';
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
  context.waitUntil(withDatabaseConnectionString(connectionString,async()=>{
   const steps=[['webhook',()=>processMetaWebhookBatches(50)],['storage',()=>processStorageDeletionJobs(50)],['cleanup',cleanupExpiredOperationalData],['automations',runAutomationScheduler],['lead_recovery',runLeadRecoveryScheduler],['monitoring',runOperationalMonitoring],['operational_notifications',()=>processOperationalAlertDeliveries(25)]] as const;
   let failed=false;
   for(const [step,run] of steps)try{await run();}catch(error){failed=true;console.error('operational_step_failed',{step,type:error instanceof Error?error.name:'unknown'});}
   if(failed)throw new Error('One or more operational steps failed.');
  }));
 },
};
export default automationWorker;
