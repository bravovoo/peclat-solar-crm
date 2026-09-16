import pg from 'pg';
import { getCloudflareContext } from '@opennextjs/cloudflare';

declare global {
  interface CloudflareEnv {
    HYPERDRIVE?: { connectionString: string };
  }
}

const globalDb = globalThis as unknown as { peclatPool?: pg.Pool; peclatPoolUrl?: string };

function connection() {
  let cloudflareEnv: CloudflareEnv | undefined;
  try {
    cloudflareEnv = getCloudflareContext().env;
  } catch {
    // O Next local não possui contexto Cloudflare e usa DATABASE_URL.
  }
  if (cloudflareEnv) {
    const binding = cloudflareEnv.HYPERDRIVE;
    if (!binding?.connectionString) throw new Error('Binding HYPERDRIVE ausente');
    return { connectionString: binding.connectionString, hyperdrive: true };
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL ausente');
  return { connectionString: process.env.DATABASE_URL, hyperdrive: false };
}

export function database() {
  const config = connection();
  if (globalDb.peclatPool && globalDb.peclatPoolUrl === config.connectionString) return globalDb.peclatPool;
  const pool = new pg.Pool({
    connectionString: config.connectionString,
    max: config.hyperdrive ? 1 : 10,
    maxUses: config.hyperdrive ? 1 : Infinity,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: config.hyperdrive ? 1000 : 30000,
    statement_timeout: 10000,
  });
  pool.on('error', () => console.error('database_idle_connection_failed'));
  globalDb.peclatPool = pool;
  globalDb.peclatPoolUrl = config.connectionString;
  return pool;
}
export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await database().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
