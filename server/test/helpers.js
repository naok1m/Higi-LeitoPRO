import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

// Sobe um PostgreSQL descartável para os testes (apagado ao final).
export const startTestDatabase = async () => {
  const databaseDir = await mkdtemp(path.join(tmpdir(), 'higi-pg-test-'));
  const port = 55000 + Math.floor(Math.random() * 5000);
  const postgres = new EmbeddedPostgres({
    databaseDir,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase('higi_test');
  return {
    url: `postgres://postgres:postgres@127.0.0.1:${port}/higi_test`,
    stop: async () => {
      await postgres.stop();
      // No Windows o Postgres demora um instante para soltar os arquivos.
      await rm(databaseDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }).catch(() => {});
    },
  };
};

export const createApiClient = (origin) => async (pathname, { method = 'GET', body, cookie } = {}) => {
  const response = await fetch(`${origin}${pathname}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  return {
    status: response.status,
    payload,
    cookie: response.headers.get('set-cookie')?.split(';')[0],
  };
};
