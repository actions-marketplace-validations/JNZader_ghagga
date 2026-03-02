import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Database = ReturnType<typeof createDatabase>;

/**
 * Create a Drizzle database client from a connection string.
 * Uses node-postgres (pg) as the driver.
 */
export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  return drizzle(pool, { schema });
}

/**
 * Create a database client from the DATABASE_URL environment variable.
 * Throws if DATABASE_URL is not set.
 */
export function createDatabaseFromEnv() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return createDatabase(url);
}
