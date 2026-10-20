import { getPool } from '../db/pool.js';

export const replaceUserResetToken = async ({ tokenHash, userId, expiresAt }, db = getPool()) => {
  await db.query('delete from password_reset_tokens where user_id = $1', [userId]);
  await db.query(
    'insert into password_reset_tokens (token_hash, user_id, expires_at) values ($1, $2, $3)',
    [tokenHash, userId, expiresAt],
  );
};

// Apaga e devolve o dono do token, se ele ainda for válido. Use dentro de uma transação.
export const consumeResetToken = async (tokenHash, db = getPool()) => {
  const { rows } = await db.query(
    'delete from password_reset_tokens where token_hash = $1 returning user_id, expires_at',
    [tokenHash],
  );
  const reset = rows[0];
  return reset && reset.expires_at > new Date() ? reset.user_id : null;
};

export const deleteExpiredResetTokens = async (db = getPool()) => {
  const { rowCount } = await db.query('delete from password_reset_tokens where expires_at <= now()');
  return rowCount;
};
