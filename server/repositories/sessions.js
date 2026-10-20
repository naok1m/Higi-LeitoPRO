import { createHash } from 'node:crypto';
import { getPool } from '../db/pool.js';

export const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export const insertSession = async ({ tokenHash, userId, activeCompanyId, expiresAt }, db = getPool()) => {
  await db.query(
    'insert into sessions (token_hash, user_id, active_company_id, expires_at) values ($1, $2, $3, $4)',
    [tokenHash, userId, activeCompanyId, expiresAt],
  );
};

export const findSessionWithUser = async (tokenHash, db = getPool()) => {
  const { rows } = await db.query(
    `select s.token_hash, s.active_company_id, s.expires_at,
            u.id, u.email, u.role, u.company_ids, u.active, u.password_hash, u.password_salt, u.profile
       from sessions s
       join users u on u.id = s.user_id
      where s.token_hash = $1`,
    [tokenHash],
  );
  return rows[0] || null;
};

export const isSessionActive = async (tokenHash, db = getPool()) => {
  const { rowCount } = await db.query(
    'select 1 from sessions where token_hash = $1 and expires_at > now()',
    [tokenHash],
  );
  return rowCount > 0;
};

export const setSessionCompany = async (tokenHash, companyId, db = getPool()) => {
  await db.query('update sessions set active_company_id = $2 where token_hash = $1', [tokenHash, companyId]);
};

export const deleteSession = async (tokenHash, db = getPool()) => {
  await db.query('delete from sessions where token_hash = $1', [tokenHash]);
};

export const deleteUserSessions = async (userId, db = getPool()) => {
  const { rows } = await db.query('delete from sessions where user_id = $1 returning token_hash', [userId]);
  return rows.map(({ token_hash: tokenHash }) => tokenHash);
};

export const deleteExpiredSessions = async (db = getPool()) => {
  const { rowCount } = await db.query('delete from sessions where expires_at <= now()');
  return rowCount;
};
