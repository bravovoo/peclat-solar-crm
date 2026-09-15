import {loadEnvFile} from 'node:process';
import {ensureSupabaseDocumentBucket} from '../src/modules/documents/supabase-storage';

try{loadEnvFile('.env');}catch{throw new Error('Crie o .env antes de preparar o armazenamento.');}
const bucket=await ensureSupabaseDocumentBucket();
console.log(`Bucket privado configurado: ${bucket}. Limite: 10 MB. MIME: application/pdf.`);
