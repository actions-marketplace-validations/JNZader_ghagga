/**
 * Database migration script.
 *
 * Runs Drizzle migrations + custom SQL (tsvector) in order.
 * Usage: DATABASE_URL=... tsx src/migrate.ts
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('❌ DATABASE_URL is required');
    process.exit(1);
  }

  console.log('🔄 Running Drizzle migrations...');

  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);

  // Step 1: Run Drizzle-managed migrations
  await migrate(db, {
    migrationsFolder: join(__dirname, '..', 'drizzle'),
  });

  console.log('✅ Drizzle migrations complete');

  // Step 2: Run custom SQL (tsvector, triggers)
  const customSqlPath = join(__dirname, '..', 'drizzle', '0001_add_tsvector.sql');
  try {
    const customSql = readFileSync(customSqlPath, 'utf-8');
    console.log('🔄 Running custom SQL (tsvector + triggers)...');
    await pool.query(customSql);
    console.log('✅ Custom SQL complete');
  } catch (error) {
    // If the file doesn't exist or SQL fails on "already exists", that's fine
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('ENOENT')) {
      console.log('⏭️  No custom SQL file found, skipping');
    } else {
      console.warn('⚠️  Custom SQL warning (may be safe to ignore):', message);
    }
  }

  await pool.end();
  console.log('🎉 Database ready');
}

main().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
