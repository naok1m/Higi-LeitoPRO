import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../lib/logger.js';
import { withTransaction } from './pool.js';

const migrationsDir = path.join(import.meta.dirname, 'migrations');
const MIGRATION_LOCK_KEY = 7208541001;

// Aplica, em ordem, os arquivos NNN_nome.sql que ainda não rodaram neste banco.
// API e worker chamam isto ao iniciar; o lock impede que rodem ao mesmo tempo.
export const runMigrations = async () => withTransaction(async (client) => {
  await client.query('select pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY]);
  await client.query(`
    create table if not exists schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    )
  `);
  const { rows } = await client.query('select version from schema_migrations');
  const applied = new Set(rows.map(({ version }) => version));
  const files = (await readdir(migrationsDir)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort();

  const newlyApplied = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    await client.query(await readFile(path.join(migrationsDir, file), 'utf8'));
    await client.query('insert into schema_migrations (version) values ($1)', [file]);
    newlyApplied.push(file);
  }
  if (newlyApplied.length) logger.info(`Migrations aplicadas: ${newlyApplied.join(', ')}`);
  return newlyApplied;
});
