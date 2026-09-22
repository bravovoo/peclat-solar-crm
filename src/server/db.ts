import pg from 'pg';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import {AsyncLocalStorage} from 'node:async_hooks';

declare global {
  interface CloudflareEnv {
    HYPERDRIVE?: { connectionString: string };
  }
}

const globalDb = globalThis as unknown as { peclatPool?: pg.Pool; peclatPoolUrl?: string };
const connectionOverride=new AsyncLocalStorage<string>();
type Database = Pick<pg.Pool, 'query' | 'end'>;
type QueryClient = Pick<pg.Client, 'query'>;

function connection() {
  const override=connectionOverride.getStore();
  if(override)return {connectionString:override,hyperdrive:true};
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
export function withDatabaseConnectionString<T>(connectionString:string,work:()=>Promise<T>){return connectionOverride.run(connectionString,work);}

function localPool(connectionString: string) {
  if (globalDb.peclatPool && globalDb.peclatPoolUrl === connectionString) return globalDb.peclatPool;
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
  });
  pool.on('error', () => console.error('database_idle_connection_failed'));
  globalDb.peclatPool = pool;
  globalDb.peclatPoolUrl = connectionString;
  return pool;
}

function hyperdriveClient(connectionString: string) {
  return new pg.Client({ connectionString, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
}

async function closeHyperdriveClient(client: pg.Client) {
  try {
    await client.end();
  } catch (error) {
    console.error('database_client_close_failed', { type: error instanceof Error ? error.name : 'unknown' });
  }
}

export function database(): Database {
  const config = connection();
  if (!config.hyperdrive) return localPool(config.connectionString);
  return {
    query: (async (text: string, values?: unknown[]) => {
      const client = hyperdriveClient(config.connectionString);
      try {
        await client.connect();
        return await client.query(text, values);
      } finally {
        await closeHyperdriveClient(client);
      }
    }) as pg.Pool['query'],
    end: async () => {},
  };
}

async function runTransaction<T>(client: QueryClient, work: (client: QueryClient) => Promise<T>): Promise<T> {
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('database_rollback_failed', { type: rollbackError instanceof Error ? rollbackError.name : 'unknown' });
    }
    throw error;
  }
}

export async function transaction<T>(work: (client: QueryClient) => Promise<T>): Promise<T> {
  const config = connection();
  if (config.hyperdrive) {
    const client = hyperdriveClient(config.connectionString);
    try {
      await client.connect();
      return await runTransaction(client, work);
    } finally {
      await closeHyperdriveClient(client);
    }
  }
  const client = await localPool(config.connectionString).connect();
  try {
    return await runTransaction(client, work);
  } finally {
    client.release();
  }
}
