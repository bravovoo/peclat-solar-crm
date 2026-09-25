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
  context.waitUntil((async()=>{
   const [
    {withDatabaseConnectionString},
    {runAutomationScheduler},
    {processMetaWebhookBatches},
    {cleanupExpiredOperationalData,processStorageDeletionJobs},
    {runOperationalMonitoring},
    {processOperationalAlertDeliveries},
    {runLeadRecoveryScheduler},
   ]=await Promise.all([
    import('./src/server/db'),
    import('./src/modules/automations/engine'),
    import('./src/modules/whatsapp/webhook'),
    import('./src/modules/operations/maintenance'),
    import('./src/modules/operations/monitoring'),
    import('./src/modules/operations/notifications'),
    import('./src/modules/lead-recovery/engine'),
   ]);
   await withDatabaseConnectionString(connectionString,async()=>{
    const steps=[['webhook',()=>processMetaWebhookBatches(50)],['storage',()=>processStorageDeletionJobs(50)],['cleanup',cleanupExpiredOperationalData],['automations',runAutomationScheduler],['lead_recovery',runLeadRecoveryScheduler],['monitoring',runOperationalMonitoring],['operational_notifications',()=>processOperationalAlertDeliveries(25)]] as const;
    let failed=false;
    for(const [step,run] of steps)try{await run();}catch(error){failed=true;console.error('operational_step_failed',{step,type:error instanceof Error?error.name:'unknown'});}
    if(failed)throw new Error('One or more operational steps failed.');
   });
  })());
 },
};
export default automationWorker;
