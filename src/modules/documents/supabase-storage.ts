import {AccessError} from '@/modules/auth/policy';

const DEFAULT_BUCKET='peclat-crm-documents';
const PDF_LIMIT=10*1024*1024;
const keyPattern=/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/;
const installationKeyPattern=/^[0-9a-f-]{36}\/(?:installations\/[0-9a-f-]{36}|post-sales\/(?:warranty|ticket|maintenance)\/[0-9a-f-]{36})\/[0-9a-f-]{36}\.(?:png|jpe?g|webp|pdf|xlsx?|csv|docx?|txt)$/;
export const storageMimeTypes=['application/pdf','image/png','image/jpeg','image/webp','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','text/csv','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword','text/plain'] as const;

type StorageConfig={url:string;secret:string;bucket:string};

function configuration():StorageConfig{
 const rawUrl=process.env.SUPABASE_URL?.trim();
 const secret=process.env.SUPABASE_SECRET_KEY?.trim()||process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
 const bucket=process.env.SUPABASE_STORAGE_BUCKET?.trim()||DEFAULT_BUCKET;
 if(!rawUrl||!secret)throw new AccessError(503,'O armazenamento de documentos não foi configurado.');
 let url:URL;try{url=new URL(rawUrl);}catch{throw new AccessError(503,'A URL do armazenamento de documentos é inválida.');}
 if(url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))throw new AccessError(503,'O armazenamento de documentos exige HTTPS.');
 if(!/^[a-z0-9][a-z0-9._-]{1,62}$/.test(bucket))throw new AccessError(503,'O bucket de documentos é inválido.');
 return {url:url.origin,secret,bucket};
}

function storageKey(key:string){
 if(!keyPattern.test(key)&&!installationKeyPattern.test(key))throw new AccessError(500,'Referência de arquivo inválida.');
 return key.split('/').map(encodeURIComponent).join('/');
}

function headers(config:StorageConfig,json=false){
 return {apikey:config.secret,Authorization:`Bearer ${config.secret}`,...(json?{'Content-Type':'application/json'}:{})};
}

async function storageError(response:Response,operation:string):Promise<AccessError>{
 try{await response.body?.cancel();}catch{}
 if(response.status===404)return new AccessError(404,'Arquivo PDF não encontrado no armazenamento.');
 if(response.status===409)return new AccessError(409,'Já existe um arquivo para este documento.');
 return new AccessError(503,`Não foi possível ${operation} o PDF no armazenamento.`);
}

export async function uploadSupabasePdf(key:string,bytes:Uint8Array){
 return uploadSupabaseObject(key,bytes,'application/pdf');
}

export async function uploadSupabaseObject(key:string,bytes:Uint8Array,mimeType:string){
 const config=configuration(),path=storageKey(key);
 const response=await fetch(`${config.url}/storage/v1/object/${encodeURIComponent(config.bucket)}/${path}`,{
  method:'POST',headers:{...headers(config),'Content-Type':mimeType,'Cache-Control':'no-store','x-upsert':'false'},body:Buffer.from(bytes),cache:'no-store'
 });
 if(!response.ok)throw await storageError(response,'armazenar');
}

export async function downloadSupabasePdf(key:string){
 return downloadSupabaseObject(key);
}

export async function downloadSupabaseObject(key:string){
 const config=configuration(),path=storageKey(key);
 const response=await fetch(`${config.url}/storage/v1/object/authenticated/${encodeURIComponent(config.bucket)}/${path}`,{headers:headers(config),cache:'no-store'});
 if(!response.ok)throw await storageError(response,'carregar');
 return Buffer.from(await response.arrayBuffer());
}

export async function removeSupabasePdf(key:string){
 return removeSupabaseObject(key);
}

export async function removeSupabaseObject(key:string){
 const config=configuration();storageKey(key);
 const response=await fetch(`${config.url}/storage/v1/object/${encodeURIComponent(config.bucket)}`,{
  method:'DELETE',headers:headers(config,true),body:JSON.stringify({prefixes:[key]}),cache:'no-store'
 });
 if(!response.ok&&response.status!==404)throw await storageError(response,'remover');
}

export async function ensureSupabaseDocumentBucket(){
 const config=configuration();
 const settings={public:false,file_size_limit:PDF_LIMIT,allowed_mime_types:[...storageMimeTypes]};
 const bucketUrl=`${config.url}/storage/v1/bucket/${encodeURIComponent(config.bucket)}`;
 const current=await fetch(bucketUrl,{headers:headers(config),cache:'no-store'});
 if(current.status===404){const created=await fetch(`${config.url}/storage/v1/bucket`,{method:'POST',headers:headers(config,true),body:JSON.stringify({id:config.bucket,name:config.bucket,...settings}),cache:'no-store'});if(!created.ok)throw await storageError(created,'criar');return config.bucket;}
 if(!current.ok)throw await storageError(current,'consultar');
 const update=await fetch(bucketUrl,{method:'PUT',headers:headers(config,true),body:JSON.stringify(settings),cache:'no-store'});
 if(!update.ok)throw await storageError(update,'configurar');
 return config.bucket;
}
