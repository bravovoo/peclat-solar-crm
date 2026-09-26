// O artefato é criado pelo OpenNext antes do bundle do Wrangler.
// @ts-expect-error módulo gerado durante pnpm run cloudflare:build
import openNextWorker,{BucketCachePurge} from './.open-next/worker.js';

type WorkerEnv={HYPERDRIVE?:{connectionString:string}};
type ExecutionContextLike={waitUntil(promise:Promise<unknown>):void};
type ScheduledController={scheduledTime?:number};

export {BucketCachePurge};
const automationWorker={
 fetch(request:Request,env:WorkerEnv,context:ExecutionContextLike){return openNextWorker.fetch(request,env,context);},
 scheduled(controller:ScheduledController,env:WorkerEnv,context:ExecutionContextLike){
  const connectionString=env.HYPERDRIVE?.connectionString;
  if(!connectionString){console.error('automation_scheduler_unavailable',{reason:'hyperdrive_binding_missing'});return;}
  context.waitUntil((async()=>{
   const cronStarted=Date.now(),{withDatabaseConnectionString}=await import('./src/server/db');
   await withDatabaseConnectionString(connectionString,async()=>{
    let failed=false;
    const run=async(step:string,operation:()=>Promise<unknown>)=>{const started=Date.now();try{const result=await operation();console.info('operational_step_completed',{step,duration_ms:Date.now()-started,result});}catch(error){failed=true;console.error('operational_step_failed',{step,duration_ms:Date.now()-started,type:error instanceof Error?error.name:'unknown'});}};
    await run('webhook',async()=>{const {processMetaWebhookBatches}=await import('./src/modules/whatsapp/webhook');return processMetaWebhookBatches(10);});
    await run('consent_requests',async()=>{const {processAutomaticConsentRequests}=await import('./src/modules/whatsapp/consent-request');return processAutomaticConsentRequests(5);});
    await run('lead_recovery',async()=>{const {runLeadRecoveryScheduler}=await import('./src/modules/lead-recovery/engine');return runLeadRecoveryScheduler();});
    const slot=Math.floor((controller.scheduledTime??Date.now())/300000)%3;
    if(slot===0)await run('automations',async()=>{const {runAutomationScheduler}=await import('./src/modules/automations/engine');return runAutomationScheduler();});
    else if(slot===1){
     await run('storage',async()=>{const {processStorageDeletionJobs}=await import('./src/modules/operations/maintenance');return processStorageDeletionJobs(20);});
     await run('cleanup',async()=>{const {cleanupExpiredOperationalData}=await import('./src/modules/operations/maintenance');return cleanupExpiredOperationalData();});
    }else{
     await run('monitoring',async()=>{const {runOperationalMonitoring}=await import('./src/modules/operations/monitoring');return runOperationalMonitoring();});
     await run('operational_notifications',async()=>{const {processOperationalAlertDeliveries}=await import('./src/modules/operations/notifications');return processOperationalAlertDeliveries(10);});
    }
    console.info('operational_cron_completed',{duration_ms:Date.now()-cronStarted,slot,failed});
    if(failed)throw new Error('One or more operational steps failed.');
   });
  })());
 },
};
export default automationWorker;
