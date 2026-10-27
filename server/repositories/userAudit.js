import { randomUUID } from 'node:crypto';
import { getPool } from '../db/pool.js';

export const recordUserAudit = async ({ userId, actor, action, details = {} }, db = getPool()) => {
  await db.query(
    `insert into user_audit_events (id, user_id, actor_id, actor_email, action, details)
     values ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), userId, actor.id, actor.email, action, JSON.stringify(details)],
  );
};

export const listUserAudit = async (userId, db = getPool()) => {
  const { rows } = await db.query(
    `select actor_email as "actorEmail", action, details, occurred_at as "occurredAt"
       from user_audit_events
      where user_id = $1
      order by occurred_at desc
      limit 100`,
    [userId],
  );
  return rows;
};
