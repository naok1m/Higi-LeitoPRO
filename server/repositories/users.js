import { getPool } from '../db/pool.js';

// Serializa alterações de contas (ex.: regra "manter ao menos um admin ativo").
const USERS_WRITE_LOCK_KEY = 7208541003;

const knownFields = new Set(['id', 'email', 'role', 'companyIds', 'active', 'passwordHash', 'passwordSalt']);

const toUser = (row) => ({
  ...row.profile,
  id: row.id,
  email: row.email,
  role: row.role,
  companyIds: row.company_ids,
  active: row.active,
  passwordHash: row.password_hash,
  passwordSalt: row.password_salt,
});

const toProfile = (user) =>
  Object.fromEntries(Object.entries(user).filter(([field]) => !knownFields.has(field)));

const columns = 'id, email, role, company_ids, active, password_hash, password_salt, profile';

export const lockUsers = (client) => client.query('select pg_advisory_xact_lock($1)', [USERS_WRITE_LOCK_KEY]);

export const listUsers = async (db = getPool()) => {
  const { rows } = await db.query(`select ${columns} from users order by seq`);
  return rows.map(toUser);
};

export const findUserByEmail = async (email, db = getPool()) => {
  const { rows } = await db.query(`select ${columns} from users where email = $1`, [email]);
  return rows[0] ? toUser(rows[0]) : null;
};

export const findUserById = async (id, db = getPool()) => {
  const { rows } = await db.query(`select ${columns} from users where id = $1`, [id]);
  return rows[0] ? toUser(rows[0]) : null;
};

export const insertUser = async (user, db = getPool()) => {
  await db.query(
    `insert into users (id, email, role, company_ids, active, password_hash, password_salt, profile)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      user.id, user.email, user.role, user.companyIds || [], user.active !== false,
      user.passwordHash, user.passwordSalt, JSON.stringify(toProfile(user)),
    ],
  );
};

export const saveUser = async (user, db = getPool()) => {
  await db.query(
    `update users
        set email = $2, role = $3, company_ids = $4, active = $5,
            password_hash = $6, password_salt = $7, profile = $8, updated_at = now()
      where id = $1`,
    [
      user.id, user.email, user.role, user.companyIds || [], user.active !== false,
      user.passwordHash, user.passwordSalt, JSON.stringify(toProfile(user)),
    ],
  );
};

export const sessionUserFromRow = toUser;
