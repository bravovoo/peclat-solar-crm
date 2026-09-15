import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {loadEnvFile} from 'node:process';
import {database} from '../src/server/db';
import {downloadSupabasePdf,ensureSupabaseDocumentBucket,uploadSupabasePdf} from '../src/modules/documents/supabase-storage';

try{loadEnvFile('.env');}catch{throw new Error('Crie o .env antes de migrar os documentos.');}
const root=resolve(process.env.DOCUMENT_STORAGE_DIR||'.local/documents');
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
let copied=0,existing=0,missing=0;
try{
 await ensureSupabaseDocumentBucket();
 const {rows}=await database().query<{storage_key:string;content_sha256:string}>('SELECT storage_key,content_sha256 FROM crm_documents ORDER BY created_at,id');
 for(const row of rows){
  try{const remote=await downloadSupabasePdf(row.storage_key);if(hash(remote)!==row.content_sha256)throw new Error(`SHA-256 divergente no Supabase: ${row.storage_key}`);existing++;continue;}catch(error){if(!(error&&typeof error==='object'&&'status' in error&&error.status===404))throw error;}
  const local=resolve(root,row.storage_key);if(!local.startsWith(root+sep))throw new Error(`Chave de armazenamento inválida: ${row.storage_key}`);
  let bytes:Buffer;try{bytes=await readFile(local);}catch{console.error(`Arquivo local ausente: ${row.storage_key}`);missing++;continue;}
  if(hash(bytes)!==row.content_sha256)throw new Error(`SHA-256 divergente no arquivo local: ${row.storage_key}`);
  await uploadSupabasePdf(row.storage_key,bytes);copied++;
 }
 console.log(`Migração concluída. Copiados: ${copied}. Já existentes: ${existing}. Ausentes: ${missing}. Originais locais preservados.`);
 if(missing)process.exitCode=1;
}finally{await database().end();}
