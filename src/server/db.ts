import pg from 'pg';
const globalDb = globalThis as unknown as { peclatPool?: pg.Pool };
export function database() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL ausente');
  if (globalDb.peclatPool) return globalDb.peclatPool;
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL, max: 10,
    connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
    statement_timeout: 10000,
  });
  pool.on('error', () => console.error('database_idle_connection_failed'));
  globalDb.peclatPool = pool;
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
