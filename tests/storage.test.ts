import {afterEach,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {ensureSupabaseDocumentBucket} from '../src/modules/documents/supabase-storage';
import {loadPdf,removePdf,storePdf,validatePdf} from '../src/modules/documents/storage';

const originalFetch=globalThis.fetch;
const original={provider:process.env.DOCUMENT_STORAGE_PROVIDER,dir:process.env.DOCUMENT_STORAGE_DIR,url:process.env.SUPABASE_URL,secret:process.env.SUPABASE_SECRET_KEY,bucket:process.env.SUPABASE_STORAGE_BUCKET};
const key='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.pdf';
const pdf=Buffer.from('%PDF-1.4\nprivate document\n%%EOF');
const sha=createHash('sha256').update(pdf).digest('hex');

beforeEach(()=>{process.env.DOCUMENT_STORAGE_PROVIDER='supabase';process.env.SUPABASE_URL='https://project.supabase.co';process.env.SUPABASE_SECRET_KEY='server-secret-test';process.env.SUPABASE_STORAGE_BUCKET='peclat-crm-documents';});
afterEach(()=>{globalThis.fetch=originalFetch;for(const [name,value] of Object.entries(original)){const keyName={provider:'DOCUMENT_STORAGE_PROVIDER',dir:'DOCUMENT_STORAGE_DIR',url:'SUPABASE_URL',secret:'SUPABASE_SECRET_KEY',bucket:'SUPABASE_STORAGE_BUCKET'}[name]!;if(value===undefined)delete process.env[keyName];else process.env[keyName]=value;}});

test('Supabase recebe upload e download autenticados sem gravar no diretório local',async()=>{
 const dir=await mkdtemp(resolve(tmpdir(),'peclat-storage-'));process.env.DOCUMENT_STORAGE_DIR=dir;const calls:{url:string;method:string;authorization:string|null}[]=[];
 globalThis.fetch=async(input,init)=>{const url=String(input);calls.push({url,method:init?.method??'GET',authorization:new Headers(init?.headers).get('authorization')});if(url.includes('/authenticated/'))return new Response(pdf,{status:200,headers:{'content-type':'application/pdf'}});return new Response('{}',{status:200,headers:{'content-type':'application/json'}});};
 await storePdf(key,pdf);assert.deepEqual(await loadPdf(key,sha),pdf);await removePdf(key);
 assert.deepEqual(calls.map(call=>call.method),['POST','GET','DELETE']);assert.ok(calls.every(call=>call.authorization==='Bearer server-secret-test'));assert.ok(calls[1].url.includes('/object/authenticated/peclat-crm-documents/'));
 await assert.rejects(()=>readFile(resolve(dir,key)));
});

test('download mantém verificação SHA-256 e autorização não aceita chave pública ausente',async()=>{
 globalThis.fetch=async()=>new Response(Buffer.from('%PDF-1.4\nalterado\n%%EOF'),{status:200});
 await assert.rejects(()=>loadPdf(key,sha),{status:503,message:'A integridade do PDF não pôde ser confirmada.'});
 delete process.env.SUPABASE_SECRET_KEY;await assert.rejects(()=>storePdf(key,pdf),{status:503,message:'O armazenamento de documentos não foi configurado.'});
});

test('bucket é criado privado com limite de 10 MB e somente PDF',async()=>{
 const calls:{url:string;method:string;body:unknown}[]=[];globalThis.fetch=async(input,init)=>{calls.push({url:String(input),method:init?.method??'GET',body:init?.body?JSON.parse(String(init.body)):null});return calls.length===1?new Response('{}',{status:404}):new Response('{}',{status:200});};
 assert.equal(await ensureSupabaseDocumentBucket(),'peclat-crm-documents');assert.equal(calls[1].method,'POST');assert.deepEqual(calls[1].body,{id:'peclat-crm-documents',name:'peclat-crm-documents',public:false,file_size_limit:10485760,allowed_mime_types:['application/pdf']});
});

test('validação de PDF continua limitada a 10 MB',()=>{
 assert.equal(validatePdf('documento.pdf','application/pdf',pdf).sha256,sha);
 assert.throws(()=>validatePdf('documento.pdf','application/pdf',Buffer.concat([Buffer.from('%PDF-'),Buffer.alloc(10*1024*1024)])),{status:413});
});
