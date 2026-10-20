// npm run dev:db — PostgreSQL local para desenvolvimento, sem instalar nada.
// Os dados ficam em .dev-db/ (ignorado pelo git). Use no .env.local:
//   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54320/higi_leito
// No servidor de produção use o PostgreSQL instalado de verdade (veja docs/DEPLOY.md).
import { existsSync } from 'node:fs';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { projectRoot } from '../config/env.js';

const databaseDir = path.join(projectRoot, '.dev-db');
const postgres = new EmbeddedPostgres({
  databaseDir,
  port: 54320,
  user: 'postgres',
  password: 'postgres',
  persistent: true,
});

if (!existsSync(path.join(databaseDir, 'PG_VERSION'))) {
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase('higi_leito');
} else {
  await postgres.start();
}
console.log('PostgreSQL de desenvolvimento em postgres://postgres:postgres@127.0.0.1:54320/higi_leito');
console.log('Ctrl+C para parar.');

const stop = async () => {
  await postgres.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
