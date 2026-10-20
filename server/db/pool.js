import pg from 'pg';
import { getConfig } from '../config/env.js';
import { logger } from '../lib/logger.js';

let pool = null;

export const getPool = () => {
  if (!pool) {
    const config = getConfig();
    pool = new pg.Pool({
      connectionString: config.databaseUrl,
      max: config.dbPoolMax,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      application_name: 'higi-leito-pro',
    });
    // Sem este handler, a queda de uma conexão ociosa derrubaria o processo inteiro.
    pool.on('error', (error) => logger.error('Conexão ociosa com o PostgreSQL falhou.', error));
  }
  return pool;
};

export const query = (text, params) => getPool().query(text, params);

export const withTransaction = async (work, { readOnly = false, isolation = 'read committed' } = {}) => {
  const client = await getPool().connect();
  try {
    await client.query(`begin isolation level ${isolation}${readOnly ? ' read only' : ''}`);
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

export const closePool = async () => {
  if (!pool) return;
  const closing = pool;
  pool = null;
  await closing.end();
};
