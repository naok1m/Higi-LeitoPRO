// npm run db:import-json -- [caminho\users.json]
// Copia usuários e registros do antigo arquivo users.json para o PostgreSQL.
// Pode ser rodado mais de uma vez: o que já existe no banco é mantido.
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { insertEntityRecords } from '../db/entityStore.js';
import { runMigrations } from '../db/migrate.js';
import { closePool, withTransaction } from '../db/pool.js';
import { setState } from '../repositories/appState.js';
import { findUserByEmail, findUserById, insertUser } from '../repositories/users.js';
import { entityNames } from '../services/access.js';

const defaultPath = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'HigiLeitoPro', 'users.json')
  : path.join(homedir(), '.local', 'share', 'HigiLeitoPro', 'users.json');
const sourcePath = path.resolve(process.argv[2] || defaultPath);

try {
  const database = JSON.parse(await readFile(sourcePath, 'utf8'));
  if (!Array.isArray(database.users)) throw new Error('O arquivo não tem a lista "users".');
  await runMigrations();

  const summary = await withTransaction(async (client) => {
    let usersImported = 0;
    for (const user of database.users) {
      if (await findUserById(user.id, client) || await findUserByEmail(user.email, client)) continue;
      await insertUser(user, client);
      usersImported += 1;
    }
    const entities = {};
    for (const name of entityNames) {
      const records = Array.isArray(database.entities?.[name]) ? database.entities[name] : [];
      const before = (await client.query('select count(*)::int as total from entity_records where entity = $1', [name])).rows[0].total;
      await insertEntityRecords(client, name, records.filter((record) => typeof record?.id === 'string'));
      const after = (await client.query('select count(*)::int as total from entity_records where entity = $1', [name])).rows[0].total;
      entities[name] = after - before;
    }
    if (database.entitiesMigrated) await setState('entities_migrated', true, client);
    return { usersImported, entities };
  });

  console.log(`Importado de ${sourcePath}`);
  console.log(`- Usuários novos: ${summary.usersImported} (de ${database.users.length})`);
  for (const [name, count] of Object.entries(summary.entities)) console.log(`- ${name}: ${count} registros novos`);
  console.log('Sessões abertas não são importadas: todos precisarão entrar de novo.');
} catch (error) {
  console.error(`Falha ao importar ${sourcePath}:`, error.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
