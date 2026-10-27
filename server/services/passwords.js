import { pbkdf2 as pbkdf2Callback, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2 = promisify(pbkdf2Callback);
const passwordIterations = 310000;

const hashPassword = async (password, salt) =>
  (await pbkdf2(password, salt, passwordIterations, 64, 'sha512')).toString('hex');

export const makePasswordCredentials = async (password) => {
  const passwordSalt = randomBytes(16).toString('hex');
  return { passwordSalt, passwordHash: await hashPassword(password, passwordSalt) };
};

export const isStrongPassword = (password) =>
  typeof password === 'string'
  && password.length >= 12
  && /[a-z]/.test(password)
  && /[A-Z]/.test(password)
  && /\d/.test(password)
  && /[^A-Za-z0-9]/.test(password);

export const passwordsMatch = async (password, user) => {
  const candidate = Buffer.from(await hashPassword(password, user.passwordSalt), 'hex');
  const expected = Buffer.from(user.passwordHash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
};
