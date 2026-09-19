import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, newToken, tokenHash } from '../src/modules/auth/crypto';
import { requirePermission, recordScope, type Actor } from '../src/modules/auth/policy';
import { loginSchema, passwordSchema } from '../src/modules/auth/validation';
import { failure,readMutation } from '../src/server/http';
import {MailConfigurationError} from '../src/integrations/mail';
import {normalizeWhatsAppNumber} from '../src/modules/whatsapp/domain';
import {GET as verifyWhatsAppWebhook,POST as receiveWhatsAppWebhook} from '../src/app/api/whatsapp/webhook/route';
test('senha usa salt exclusivo e comparação rejeita senha incorreta', async()=>{
  const a=await hashPassword('Senha longa e única'); const b=await hashPassword('Senha longa e única');
  assert.notEqual(a,b); assert.equal(await verifyPassword('Senha longa e única',a),true);
  assert.equal(await verifyPassword('senha incorreta',a),false);assert.equal(await verifyPassword('x','malformado'),false);
});
test('tokens opacos e hashes não revelam o token original',()=>{const a=newToken();assert.match(a,/^[a-f0-9]{64}$/);assert.notEqual(a,newToken());assert.notEqual(a,tokenHash(a));});
test('nega permissão por padrão e restringe vendedor ao próprio dono',()=>{
  const actor={userId:'user-a',organizationId:'org-a',permissions:['crm.own']} as Actor;
  assert.throws(()=>requirePermission(actor,'team.read'));assert.deepEqual(recordScope(actor,'crm.all'),{organizationId:'org-a',ownerId:'user-a'});
  assert.deepEqual(recordScope({...actor,permissions:['crm.all']},'crm.all'),{organizationId:'org-a',ownerId:undefined});
});
test('validação normaliza identidade, limita senha e rejeita tenant inválido',()=>{
  const data=loginSchema.parse({organization:' PECLAT-SOLAR ',email:'ADMIN@EXAMPLE.COM',password:'secret'});
  assert.equal(data.email,'admin@example.com');assert.equal(data.organization,'peclat-solar');
  assert.equal(passwordSchema.safeParse('curta').success,false);assert.equal(passwordSchema.safeParse('x'.repeat(129)).success,false);
  assert.equal(loginSchema.safeParse({...data,organization:"' OR 1=1"}).success,false);
});
test('mutações rejeitam CSRF, payload enorme e JSON inválido',async()=>{
  process.env.APP_URL='http://localhost:3000';
  const req=(body:string,origin='http://localhost:3000')=>new Request('http://localhost:3000/api/auth/login',{method:'POST',headers:{origin,'Content-Type':'application/json'},body});
  await assert.rejects(()=>readMutation(req('{}','https://attacker.example')),{status:403});
  await assert.rejects(()=>readMutation(req('x'.repeat(17000))),{status:413});
  await assert.rejects(()=>readMutation(req('{oops')),{status:400});
  assert.deepEqual(await readMutation(req('{"ok":true}')),{ok:true});
});
test('SMTP ausente retorna erro explícito sem detalhes internos',async()=>{const response=failure(new MailConfigurationError());assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'O envio por e-mail está indisponível porque o SMTP não foi configurado.'});});
test('normalização do WhatsApp preserva original e aceita números brasileiros e internacionais',()=>{const brazil=normalizeWhatsAppNumber('(31) 99999-1234');assert.deepEqual(brazil,{original:'(31) 99999-1234',digits:'5531999991234',e164:'+5531999991234',valid:true});const international=normalizeWhatsAppNumber('+1 (415) 555-2671');assert.equal(international.original,'+1 (415) 555-2671');assert.equal(international.e164,'+14155552671');assert.equal(international.valid,true);assert.equal(normalizeWhatsAppNumber('123').valid,false);assert.equal(normalizeWhatsAppNumber('+55 01 99999-9999').valid,false);});
test('webhook WhatsApp sem configuração não verifica nem recebe eventos',async()=>{const previous=process.env.WHATSAPP_VERIFY_TOKEN;delete process.env.WHATSAPP_VERIFY_TOKEN;try{const verification=await verifyWhatsAppWebhook(new Request('http://localhost/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=segredo&hub.challenge=42'));assert.equal(verification.status,503);assert.deepEqual(await verification.json(),{error:'Webhook ainda não configurado.'});const receipt=await receiveWhatsAppWebhook();assert.equal(receipt.status,503);assert.deepEqual(await receipt.json(),{error:'Recebimento de eventos ainda não está habilitado.'});}finally{if(previous===undefined)delete process.env.WHATSAPP_VERIFY_TOKEN;else process.env.WHATSAPP_VERIFY_TOKEN=previous;}});
test('webhook WhatsApp verifica challenge sem revelar token e continua recusando eventos',async()=>{const previous=process.env.WHATSAPP_VERIFY_TOKEN;process.env.WHATSAPP_VERIFY_TOKEN='token-exclusivo-de-teste';try{const valid=await verifyWhatsAppWebhook(new Request('http://localhost/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=token-exclusivo-de-teste&hub.challenge=desafio-123'));assert.equal(valid.status,200);assert.equal(await valid.text(),'desafio-123');const invalid=await verifyWhatsAppWebhook(new Request('http://localhost/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=incorreto&hub.challenge=desafio-123'));assert.equal(invalid.status,403);assert.deepEqual(await invalid.json(),{error:'Verificação recusada.'});assert.equal((await receiveWhatsAppWebhook()).status,503);}finally{if(previous===undefined)delete process.env.WHATSAPP_VERIFY_TOKEN;else process.env.WHATSAPP_VERIFY_TOKEN=previous;}});
