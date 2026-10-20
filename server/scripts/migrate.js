// npm run db:migrate — cria/atualiza as tabelas no PostgreSQL configurado no .env.
import { runMigrations } from '../db/migrate.js';
import { closePool } from '../db/pool.js';

try {
  const applied = await runMigrations();
  console.log(applied.length ? `Banco atualizado: ${applied.join(', ')}` : 'Banco já está atualizado.');
} catch (error) {
  console.error('Falha ao atualizar o banco:', error.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
