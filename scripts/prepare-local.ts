import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
await mkdir('.local',{recursive:true});
const password=randomBytes(18).toString('base64url');
const dbPassword=randomBytes(24).toString('hex');
const example=await readFile('.env.example','utf8');
const env=example.replace(/^DATABASE_URL=.*$/m,`DATABASE_URL=postgresql://peclat:${dbPassword}@127.0.0.1:55432/peclat`)
  .replace(/^SEED_ADMIN_PASSWORD=.*$/m,`SEED_ADMIN_PASSWORD=${password}`)
  .replace(/^SMTP_HOST=.*$/m,'SMTP_HOST=');
try {
  await writeFile('.env',env,{flag:'wx'});
  await writeFile('.local/ACESSO_LOCAL.md',`# Acesso local — Peclat Solar\n\nURL: http://localhost:3000\n\nOrganização: peclat-solar\n\nE-mail: admin@peclat.local\n\nSenha inicial: ${password}\n\nCredenciais exclusivas para desenvolvimento. Este arquivo e o .env são ignorados pelo Git. Não compartilhe nem publique esses arquivos.\n`,{flag:'wx'});
  console.log('Ambiente criado. Credenciais em .local/ACESSO_LOCAL.md. Execute db:local, db:migrate e db:seed.');
} catch(error) {
  if(error instanceof Error && 'code' in error && error.code==='EEXIST')console.log('Configuração existente preservada; nenhum arquivo foi sobrescrito.');
  else throw error;
}
