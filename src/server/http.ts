import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AccessError } from '../modules/auth/policy';
import { MailConfigurationError } from '../integrations/mail';
export function appUrl() {
  const value = process.env.APP_URL;
  if (!value) throw new Error('APP_URL ausente');
  const url = new URL(value);
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('HTTPS obrigatório');
  return url.origin;
}
export async function readMutation(request: Request) {
  if (request.headers.get('origin') !== appUrl()) throw new AccessError(403, 'Origem da solicitação não permitida.');
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new AccessError(415, 'Formato inválido.');
  if (!request.body) throw new AccessError(400, 'Dados ausentes.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size=0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size>16384) { await reader.cancel(); throw new AccessError(413, 'Solicitação muito grande.'); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { throw new AccessError(400, 'Dados inválidos.'); }
}
export async function readMultipartMutation(request:Request,maxBytes:number){
 if(request.headers.get('origin')!==appUrl())throw new AccessError(403,'Origem da solicitação não permitida.');
 const contentType=request.headers.get('content-type')??'';if(!contentType.startsWith('multipart/form-data;'))throw new AccessError(415,'Formato inválido.');
 const declared=Number(request.headers.get('content-length')??0);if(declared>maxBytes)throw new AccessError(413,'Solicitação muito grande.');
 if(!request.body)throw new AccessError(400,'Dados ausentes.');const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes){await reader.cancel();throw new AccessError(413,'Solicitação muito grande.');}chunks.push(value);}
 try{return await new Request('http://local/upload',{method:'POST',headers:{'content-type':contentType},body:Buffer.concat(chunks)}).formData();}catch{throw new AccessError(400,'Formulário de upload inválido.');}
}
export function failure(error: unknown) {
  if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
  if(error instanceof MailConfigurationError)return NextResponse.json({error:'O envio por e-mail está indisponível porque o SMTP não foi configurado.'},{status:503,headers:{'Cache-Control':'no-store'}});
  if (error instanceof ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? 'Dados inválidos.' }, { status: 400 });
  console.error('request_failed', { type: error instanceof Error ? error.name : 'unknown' });
  return NextResponse.json({ error: 'Serviço indisponível no momento. Tente novamente.' }, { status: 503 });
}
