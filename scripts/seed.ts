import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { database, transaction } from '../src/server/db';
import { hashPassword } from '../src/modules/auth/crypto';
import { emailSchema, passwordSchema } from '../src/modules/auth/validation';
export const roleDefinitions = [
  ['admin', 'Administrador', ['dashboard.read', 'team.read', 'commercial_team.read', 'commercial_team.manage', 'commercial_goals.read', 'commercial_goals.manage', 'settings.read', 'audit.read', 'users.read', 'users.manage', 'crm.all', 'crm.own', 'crm.duplicate.override', 'crm.delete', 'crm.tags.manage', 'solar.catalog.manage', 'contracts.all', 'contracts.own', 'contracts.create', 'contracts.edit', 'contracts.cancel', 'contracts.payments.read', 'contracts.payments.manage', 'installations.read', 'installations.create', 'installations.edit', 'installations.manage', 'post_sales.read', 'post_sales.create', 'post_sales.edit', 'post_sales.manage', 'whatsapp.use', 'whatsapp.templates.manage', 'automations.read', 'automations.manage', 'ai_assistant.use', 'ai_assistant.manage', 'operations.read', 'operations.manage', 'lead_recovery.read', 'lead_recovery.manage', 'lead_recovery.operate', 'postsales.read']],
  ['manager', 'Gerente Comercial', ['dashboard.read', 'team.read', 'commercial_team.read', 'commercial_team.manage', 'commercial_goals.read', 'commercial_goals.manage', 'crm.all', 'crm.own', 'crm.duplicate.override', 'crm.delete', 'solar.catalog.manage', 'contracts.all', 'contracts.own', 'contracts.create', 'contracts.edit', 'contracts.cancel', 'contracts.payments.read', 'contracts.payments.manage', 'installations.read', 'installations.create', 'installations.edit', 'installations.manage', 'post_sales.read', 'post_sales.create', 'post_sales.edit', 'post_sales.manage', 'whatsapp.use', 'automations.read', 'automations.manage', 'ai_assistant.use', 'lead_recovery.read', 'lead_recovery.operate']],
  ['seller', 'Vendedor', ['dashboard.read', 'commercial_team.read', 'commercial_goals.read', 'crm.own', 'contracts.own', 'contracts.create', 'contracts.edit', 'contracts.payments.read', 'installations.read', 'installations.create', 'installations.edit', 'post_sales.read', 'post_sales.create', 'whatsapp.use', 'ai_assistant.use', 'lead_recovery.read', 'lead_recovery.operate']],
  ['support', 'Atendimento', ['dashboard.read', 'crm.own', 'contracts.own', 'contracts.payments.read', 'installations.read', 'post_sales.read', 'post_sales.create', 'post_sales.edit', 'whatsapp.use']],
  ['technician', 'Técnico', ['dashboard.read', 'installations.read', 'installations.edit', 'installations.manage', 'post_sales.read', 'post_sales.create', 'post_sales.edit']],
  ['postsales', 'Pós-venda', ['dashboard.read', 'postsales.read', 'post_sales.read', 'post_sales.create', 'post_sales.edit', 'post_sales.manage']],
] as const;
export async function seed() {
  const email = emailSchema.parse(process.env.SEED_ADMIN_EMAIL);
  const password = passwordSchema.parse(process.env.SEED_ADMIN_PASSWORD);
  const name = process.env.SEED_ADMIN_NAME?.trim() || 'Administrador Peclat';
  const hash = await hashPassword(password);
  await transaction(async client => {
    for (const [code, label, permissions] of roleDefinitions) {
      await client.query('INSERT INTO roles(code,name) VALUES ($1,$2) ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name', [code, label]);
      for (const permission of permissions) {
        await client.query('INSERT INTO permissions(code,description) VALUES ($1,$1) ON CONFLICT DO NOTHING', [permission]);
        await client.query('INSERT INTO role_permissions(role_code,permission_code) VALUES ($1,$2) ON CONFLICT DO NOTHING', [code, permission]);
      }
    }
    const org = await client.query("INSERT INTO organizations(slug,name) VALUES ('peclat-solar','Peclat Solar') ON CONFLICT(slug) DO UPDATE SET slug=EXCLUDED.slug RETURNING id");
    const user = await client.query('INSERT INTO users(email,name,password_hash) VALUES ($1,$2,$3) ON CONFLICT(email) DO NOTHING RETURNING id', [email, name, hash]);
    if (user.rowCount) await client.query("INSERT INTO memberships(organization_id,user_id,role_code) VALUES ($1,$2,'admin')", [org.rows[0].id, user.rows[0].id]);
    else {
      const existing = await client.query("SELECT 1 FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.email=$1 AND m.organization_id=$2 AND m.role_code='admin' AND u.active AND m.active", [email, org.rows[0].id]);
      if (!existing.rowCount) throw new Error('E-mail existente sem associação administrativa. Seed não concede privilégios a conta existente.');
    }
    const admin = await client.query<{user_id:string}>("SELECT u.id user_id FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.email=$1 AND m.organization_id=$2 AND m.role_code='admin' AND u.active AND m.active",[email,org.rows[0].id]);
    const drafts=[
      ['peclat_recuperacao_lead_1','Olá, {{1}}! Tudo bem? 😊\n\nAqui é o Rodrigo, da Peclat Solar.\n\nEstou passando para saber se você conseguiu analisar nossa proposta de energia solar e se ficou alguma dúvida.\n\nPodemos conversar sobre seu projeto?'],
      ['peclat_recuperacao_lead_2','Olá, {{1}}! Passando para saber se você ainda tem interesse em dar continuidade ao seu projeto de energia solar.\n\nSe precisar ajustar alguma informação da proposta, estou à disposição!'],
      ['peclat_recuperacao_lead_3','Olá, {{1}}! Tudo bem?\n\nGostaria de saber se seu projeto de energia solar ainda está nos seus planos.\n\nCaso prefira conversar em outro momento, é só me avisar.'],
    ];
    for(const [draftName,body] of drafts)await client.query(`INSERT INTO whatsapp_template_drafts(organization_id,name,category,language,body_text,example_values,components,created_by,updated_by) VALUES ($1,$2,'MARKETING','pt_BR',$3::text,'["Maria"]'::jsonb,jsonb_build_array(jsonb_build_object('type','BODY','text',$3::text,'example',jsonb_build_object('body_text',jsonb_build_array(jsonb_build_array('Maria'))))),$4,$4) ON CONFLICT(organization_id,name,language) DO NOTHING`,[org.rows[0].id,draftName,body,admin.rows[0].user_id]);
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  seed().then(() => console.log('Seed concluído. Senhas existentes foram preservadas.')).catch(() => { console.error('Seed não aplicado. Verifique as variáveis e a conta administradora.'); process.exitCode=1; }).finally(() => database().end());
}
