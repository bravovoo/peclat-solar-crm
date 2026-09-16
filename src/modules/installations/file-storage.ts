import {createHash} from 'node:crypto';
import {mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import {dirname,resolve,sep} from 'node:path';
import {AccessError} from '@/modules/auth/policy';
import {MAX_PDF_BYTES} from '@/modules/documents/storage';
import {downloadSupabaseObject,removeSupabaseObject,uploadSupabaseObject} from '@/modules/documents/supabase-storage';

export const MAX_INSTALLATION_FILE_BYTES=MAX_PDF_BYTES;
const keyPattern=/^[0-9a-f-]{36}\/installations\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:png|jpe?g|webp|pdf|xlsx?|csv|docx?|txt)$/;
const formats:Record<string,{mime:string;kind:'photo'|'document'}>={
 png:{mime:'image/png',kind:'photo'},jpg:{mime:'image/jpeg',kind:'photo'},jpeg:{mime:'image/jpeg',kind:'photo'},webp:{mime:'image/webp',kind:'photo'},
 pdf:{mime:'application/pdf',kind:'document'},xlsx:{mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',kind:'document'},
 xls:{mime:'application/vnd.ms-excel',kind:'document'},csv:{mime:'text/csv',kind:'document'},
 docx:{mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',kind:'document'},
 doc:{mime:'application/msword',kind:'document'},txt:{mime:'text/plain',kind:'document'}
};
function provider(){const value=process.env.DOCUMENT_STORAGE_PROVIDER?.trim().toLowerCase();if(value==='local'||value==='supabase')return value;if(value||process.env.NODE_ENV==='production')throw new AccessError(503,'O armazenamento de arquivos não foi configurado.');return 'local';}
function location(key:string){if(!keyPattern.test(key))throw new AccessError(500,'Referência de arquivo inválida.');const base=resolve(/* turbopackIgnore: true */ process.env.DOCUMENT_STORAGE_DIR||'.local/documents'),target=resolve(base,key);if(!target.startsWith(base+sep))throw new AccessError(500,'Referência de arquivo inválida.');return target;}
function validSignature(extension:string,bytes:Uint8Array){
 const b=Buffer.from(bytes);
 if(extension==='png')return b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(extension==='jpg'||extension==='jpeg')return b.length>3&&b[0]===255&&b[1]===216&&b[2]===255;
 if(extension==='webp')return b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP';
 if(extension==='pdf')return b.subarray(0,5).toString()==='%PDF-';
 if(extension==='xlsx'||extension==='docx')return b.subarray(0,4).equals(Buffer.from([80,75,3,4]))&&b.includes(Buffer.from(extension==='xlsx'?'xl/workbook.xml':'word/document.xml'));
 if(extension==='xls'||extension==='doc')return b.subarray(0,8).equals(Buffer.from([208,207,17,224,161,177,26,225]));
 if(extension==='csv'||extension==='txt'){
  if(b.includes(0))return false;
  try{new TextDecoder('utf-8',{fatal:true}).decode(b);return !b.some(byte=>byte<9||(byte>13&&byte<32));}catch{return false;}
 }
 return false;
}
export function validateInstallationFile(name:string,type:string,bytes:Uint8Array,kind:'photo'|'document'){
 const extension=name.split('.').pop()?.toLowerCase()??'',format=formats[extension];
 if(!format||format.mime!==type||(kind==='photo'&&format.kind!=='photo'))throw new AccessError(415,'Formato de arquivo não permitido.');
 if(!bytes.length)throw new AccessError(400,'O arquivo está vazio.');
 if(bytes.length>MAX_INSTALLATION_FILE_BYTES)throw new AccessError(413,'O arquivo deve ter no máximo 10 MB.');
 if(!validSignature(extension,bytes))throw new AccessError(415,'O conteúdo do arquivo não corresponde ao formato informado.');
 const safe=name.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').trim().slice(0,180);
 if(!safe)throw new AccessError(400,'Nome de arquivo inválido.');
 return {filename:safe,extension,mimeType:format.mime,sha256:createHash('sha256').update(bytes).digest('hex')};
}
export async function storeInstallationFile(key:string,bytes:Uint8Array,mimeType:string){
 location(key);if(provider()==='supabase')return uploadSupabaseObject(key,bytes,mimeType);
 const target=location(key),temporary=target+'.upload';await mkdir(dirname(target),{recursive:true});await writeFile(temporary,bytes,{flag:'wx'});
 try{await rename(temporary,target);}catch(error){await rm(temporary,{force:true});throw error;}
}
export async function loadInstallationFile(key:string,expectedHash:string){
 let bytes:Buffer;if(provider()==='supabase')bytes=await downloadSupabaseObject(key);else try{bytes=await readFile(/* turbopackIgnore: true */ location(key));}catch{throw new AccessError(404,'Arquivo não encontrado no armazenamento.');}
 if(createHash('sha256').update(bytes).digest('hex')!==expectedHash)throw new AccessError(503,'A integridade do arquivo não pôde ser confirmada.');
 return bytes;
}
export async function removeInstallationFile(key:string){location(key);if(provider()==='supabase')return removeSupabaseObject(key);await rm(location(key),{force:true});}
