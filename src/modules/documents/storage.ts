import {createHash} from 'node:crypto';
import {mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {dirname,resolve,sep} from 'node:path';
import {AccessError} from '@/modules/auth/policy';

export const MAX_PDF_BYTES=10*1024*1024;
const keyPattern=/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/;
function root(){return resolve(/* turbopackIgnore: true */ process.env.DOCUMENT_STORAGE_DIR||'.local/documents');}
function location(key:string){if(!keyPattern.test(key))throw new AccessError(500,'Referência de arquivo inválida.');const base=root(),target=resolve(base,key);if(!target.startsWith(base+sep))throw new AccessError(500,'Referência de arquivo inválida.');return target;}
export function validatePdf(originalName:string,mimeType:string,bytes:Uint8Array){
 if(!originalName.toLowerCase().endsWith('.pdf')||mimeType!=='application/pdf')throw new AccessError(415,'Selecione um arquivo PDF válido.');
 if(!bytes.length)throw new AccessError(400,'O PDF está vazio.');
 if(bytes.length>MAX_PDF_BYTES)throw new AccessError(413,'O PDF deve ter no máximo 10 MB.');
 if(Buffer.from(bytes.subarray(0,5)).toString('ascii')!=='%PDF-')throw new AccessError(415,'O conteúdo enviado não é um PDF válido.');
 const sanitized=originalName.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').trim();const filename=sanitized.length<=180?sanitized:sanitized.slice(0,176).replace(/\.pdf$/i,'')+'.pdf';
 if(!filename)throw new AccessError(400,'Nome de arquivo inválido.');
 return {filename,sha256:createHash('sha256').update(bytes).digest('hex')};
}
export async function storePdf(key:string,bytes:Uint8Array){const target=location(key),temporary=target+'.upload';await mkdir(dirname(target),{recursive:true});await writeFile(temporary,bytes,{flag:'wx'});try{await rename(temporary,target);}catch(error){await rm(temporary,{force:true});throw error;}}
export async function removePdf(key:string){await rm(location(key),{force:true});}
export async function loadPdf(key:string,expectedHash:string){let bytes:Buffer;try{bytes=await readFile(/* turbopackIgnore: true */ location(key));}catch{throw new AccessError(404,'Arquivo PDF não encontrado no armazenamento.');}const hash=createHash('sha256').update(bytes).digest('hex');if(hash!==expectedHash)throw new AccessError(503,'A integridade do PDF não pôde ser confirmada.');return bytes;}
