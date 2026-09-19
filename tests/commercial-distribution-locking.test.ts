import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import pg from 'pg';
import EmbeddedPostgres from '../scripts/embedded-db';
import { migrate } from '../scripts/migrate';
import { seed } from '../scripts/seed';
import { database } from '../src/server/db';
import type { Actor } from '../src/modules/auth/policy';
import { saveTask } from '../src/modules/commercial/repository';
import { transferPortfolio } from '../src/modules/commercial/distribution';

let server: EmbeddedPostgres;
let admin: Actor;

before(async () => {
  const port = await new Promise<number>(done => {
    const listener = createServer();
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address();
      if (address && typeof address === 'object') listener.close(() => done(address.port));
    });
  });
  await mkdir(resolve('.local/tests'), { recursive: true });
  const directory = await mkdtemp(resolve('.local/tests/distribution-locks-'));
  server = new EmbeddedPostgres({
    databaseDir: directory, user: 'test_user', password: 'test_db_password', port,
    persistent: true, authMethod: 'scram-sha-256', postgresFlags: ['-h', '127.0.0.1'],
    onLog: () => {}, onError: () => {},
  });
  await server.initialise();
  await server.start();
  await server.createDatabase('distribution_test');
  process.env.DATABASE_URL = `postgresql://test_user:test_db_password@127.0.0.1:${port}/distribution_test`;
  process.env.SEED_ADMIN_EMAIL = 'locking-admin@test.local';
  process.env.SEED_ADMIN_PASSWORD = 'Teste exclusivo 2026!';
  await migrate();
  await seed();
  const identity = (await database().query(`SELECT m.organization_id,u.id FROM memberships m
    JOIN users u ON u.id=m.user_id WHERE u.email='locking-admin@test.local'`)).rows[0];
  admin = {
    userId: identity.id, organizationId: identity.organization_id,
    name: 'Administrador de teste', email: 'locking-admin@test.local',
    organizationName: 'Peclat Solar', organizationSlug: 'peclat-solar',
    role: 'admin', roleName: 'Administrador', permissions: ['crm.all', 'commercial_team.manage'],
  };
}, { timeout: 120000 });

after(async () => {
  if (process.env.DATABASE_URL) await database().end();
  if (server) await server.stop();
});

function signal() {
  let resolveSignal!: () => void;
  const promise = new Promise<void>(resolve => { resolveSignal = resolve; });
  return { promise, resolve: resolveSignal };
}

async function awaitSignal(promise: Promise<void>) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([promise, new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error('A operação concorrente não alcançou o bloqueio esperado.')), 5000);
    })]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

test('transferência e edição simultânea de tarefa preservam dados sem deadlock', { timeout: 30000 }, async () => {
  const sellers: string[] = [];
  for (const name of ['origem', 'destino']) {
    const user = (await database().query(`INSERT INTO users(email,name,password_hash)
      VALUES ($1,$2,'test-only-unused-password') RETURNING id`, [`locking-${name}@test.local`, name])).rows[0];
    await database().query("INSERT INTO memberships(organization_id,user_id,role_code) VALUES ($1,$2,'seller')", [admin.organizationId, user.id]);
    sellers.push(user.id);
  }
  const lead = (await database().query(`INSERT INTO crm_records(organization_id,kind,owner_id,name)
    VALUES ($1,'lead',$2,'Lead concorrência de carteira') RETURNING id`, [admin.organizationId, sellers[0]])).rows[0].id;
  const opportunity = (await database().query(`INSERT INTO crm_opportunities(organization_id,lead_id,owner_id,title)
    VALUES ($1,$2,$3,'Oportunidade concorrência de carteira') RETURNING id`, [admin.organizationId, lead, sellers[0]])).rows[0].id;
  const task = await saveTask(admin, {
    title: 'Tarefa antes da edição', opportunity_id: opportunity,
    owner_id: sellers[0], due_date: '2026-09-18',
  });

  const taskLocked = signal();
  const transferUpdatingTask = signal();
  const resumeEdit = signal();
  const prototype = pg.Client.prototype as unknown as { query: (...args: unknown[]) => unknown };
  const originalQuery = prototype.query;
  // Controla somente a ordem de duas operações reais; os locks e SQL são do PostgreSQL.
  prototype.query = function (this: pg.Client, ...args: unknown[]) {
    const result = originalQuery.apply(this, args);
    const sql = args[0];
    if (typeof sql === 'string' && sql.includes('FOR UPDATE OF t')) {
      return Promise.resolve(result).then(async value => {
        taskLocked.resolve();
        await resumeEdit.promise;
        return value;
      });
    }
    if (typeof sql === 'string' && sql.startsWith('UPDATE crm_tasks SET owner_id=')) transferUpdatingTask.resolve();
    return result;
  };
  const operations: Promise<unknown>[] = [];
  try {
    const edit = saveTask(admin, {
      title: 'Tarefa editada durante transferência', opportunity_id: opportunity,
      owner_id: sellers[0], due_date: task.due_date, version: task.version,
    }, task.id);
    operations.push(edit);
    // Observa rejeições imediatamente para que falhas esperadas no código antigo não vazem.
    void edit.catch(() => {});
    await awaitSignal(taskLocked.promise);
    const transfer = transferPortfolio(admin, { from_user_id: sellers[0], to_user_id: sellers[1], confirm: true });
    operations.push(transfer);
    void transfer.catch(() => {});
    await awaitSignal(transferUpdatingTask.promise);
    resumeEdit.resolve();
    const results = await Promise.allSettled(operations);
    assert.deepEqual(results.filter(result => result.status === 'rejected'), []);
    assert.deepEqual(await transfer, { records: 1, opportunities: 1, tasks: 1 });
  } finally {
    resumeEdit.resolve();
    await Promise.allSettled(operations);
    prototype.query = originalQuery;
  }
  const current = (await database().query('SELECT title,owner_id,version FROM crm_tasks WHERE id=$1', [task.id])).rows[0];
  assert.equal(current.title, 'Tarefa editada durante transferência');
  assert.equal(current.owner_id, sellers[1]);
  assert.equal(current.version, task.version + 2);
  assert.equal((await database().query('SELECT owner_id FROM crm_opportunities WHERE id=$1', [opportunity])).rows[0].owner_id, sellers[1]);
  assert.equal((await database().query("SELECT count(*)::int total FROM crm_activities WHERE opportunity_id=$1 AND action='portfolio.transferred'", [opportunity])).rows[0].total, 1);
});
