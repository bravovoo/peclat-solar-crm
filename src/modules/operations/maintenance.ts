import type {PoolClient} from 'pg';
import {database,transaction} from '@/server/db';
import {removeInstallationFile} from '@/modules/installations/file-storage';

type Db=Pick<PoolClient,'query'>;
type DeletionJob={id:string;organization_id:string;source_type:'installation_file'|'post_sales_file';source_id:string;storage_key:string;attempts:number};

export async function enqueueStorageDeletion(db:Db,organizationId:string,sourceType:DeletionJob['source_type'],sourceId:string,storageKey:string){
 const result=await db.query<{id:string}>(`INSERT INTO storage_deletion_jobs(organization_id,source_type,source_id,storage_key) VALUES ($1,$2,$3,$4) ON CONFLICT(organization_id,source_type,source_id,storage_key) DO UPDATE SET status=CASE WHEN storage_deletion_jobs.status='completed' THEN 'completed' ELSE 'pending' END,scheduled_for=CASE WHEN storage_deletion_jobs.status='completed' THEN storage_deletion_jobs.scheduled_for ELSE now() END,updated_at=now() RETURNING id`,[organizationId,sourceType,sourceId,storageKey]);
 return result.rows[0].id;
}

async function claimStorageJobs(limit:number,ids?:string[]){return transaction(async db=>{
 const result=await db.query<DeletionJob>(`SELECT * FROM storage_deletion_jobs WHERE status='pending' AND (scheduled_for<=now() OR $2::uuid[] IS NOT NULL) AND ($2::uuid[] IS NULL OR id=ANY($2::uuid[])) ORDER BY scheduled_for,id FOR UPDATE SKIP LOCKED LIMIT $1`,[limit,ids?.length?ids:null]);
 if(result.rowCount)await db.query("UPDATE storage_deletion_jobs SET status='processing',attempts=attempts+1,locked_at=now(),updated_at=now() WHERE id=ANY($1::uuid[])",[result.rows.map(row=>row.id)]);
 return result.rows.map(row=>({...row,attempts:row.attempts+1}));
});}

async function verified(job:DeletionJob){
 if(!job.storage_key.startsWith(`${job.organization_id}/`))return false;
 const table=job.source_type==='installation_file'?'installation_files':'post_sales_files';
 const result=await database().query(`SELECT 1 FROM ${table} WHERE organization_id=$1 AND id=$2 AND storage_key=$3 AND deleted_at IS NOT NULL`,[job.organization_id,job.source_id,job.storage_key]);
 return Boolean(result.rowCount);
}

export async function processStorageDeletionJobs(limit=20,ids?:string[]){
 await database().query(`UPDATE storage_deletion_jobs SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,locked_at=NULL,scheduled_for=now()+interval '5 minutes',safe_error='storage_deletion_stale',updated_at=now() WHERE status='processing' AND locked_at<now()-interval '10 minutes'`);
 const jobs=await claimStorageJobs(limit,ids);let completed=0;
 for(const job of jobs){try{
  if(!await verified(job)){await database().query("UPDATE storage_deletion_jobs SET status='cancelled',locked_at=NULL,completed_at=now(),safe_error='storage_reference_invalid',updated_at=now() WHERE id=$1",[job.id]);continue;}
  await removeInstallationFile(job.storage_key);
  await database().query("UPDATE storage_deletion_jobs SET status='completed',locked_at=NULL,completed_at=now(),safe_error='',updated_at=now() WHERE id=$1",[job.id]);completed++;
 }catch(error){const terminal=job.attempts>=5;await database().query(`UPDATE storage_deletion_jobs SET status=$2,locked_at=NULL,scheduled_for=now()+make_interval(mins=>$3::int),safe_error='storage_delete_failed',updated_at=now() WHERE id=$1`,[job.id,terminal?'failed':'pending',job.attempts*5]);console.error('storage_deletion_failed',{type:error instanceof Error?error.name:'unknown'});}}
 return {processed:jobs.length,completed};
}

export async function cleanupExpiredOperationalData(){
 const [sessions,passwordResets,rateLimits]=await Promise.all([
  database().query('DELETE FROM sessions WHERE expires_at<=now()'),
  database().query('DELETE FROM password_resets WHERE expires_at<=now()'),
  database().query('DELETE FROM rate_limits WHERE expires_at<=now()'),
 ]);
 await database().query("DELETE FROM whatsapp_webhook_batches WHERE status='completed' AND completed_at<now()-interval '7 days'");
 await database().query("DELETE FROM storage_deletion_jobs WHERE status IN ('completed','cancelled') AND completed_at<now()-interval '30 days'");
 return {sessions:sessions.rowCount,password_resets:passwordResets.rowCount,rate_limits:rateLimits.rowCount};
}
