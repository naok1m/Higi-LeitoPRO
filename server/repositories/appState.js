import { getPool } from '../db/pool.js';

export const getState = async (key, db = getPool()) => {
  const { rows } = await db.query('select value from app_state where key = $1', [key]);
  return rows[0]?.value ?? null;
};

export const setState = async (key, value, db = getPool()) => {
  await db.query(
    `insert into app_state (key, value) values ($1, $2)
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
};
