import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, newToken, tokenHash } from '../src/modules/auth/crypto';
import { requirePermission, recordScope, type Actor } from '../src/modules/auth/policy';
import { loginSchema, passwordSchema } from '../src/modules/auth/validation';
import { failure,readMutation } from '../src/server/http';
import {MailConfigurationError} from '../src/integrations/mail';
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
