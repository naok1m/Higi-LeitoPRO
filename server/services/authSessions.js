import { randomBytes } from 'node:crypto';
import { getSessionToken, sessionDurationMs } from '../http/io.js';
import { sessionUserFromRow } from '../repositories/users.js';
import {
  deleteSession,
  deleteUserSessions,
  findSessionWithUser,
  hashToken,
  insertSession,
  setSessionCompany,
} from '../repositories/sessions.js';
import { getSessionUserData, getUserCompanyIds } from './access.js';
import { closeEventClients, sendToEventClients } from './realtime.js';

export const createSession = async (userId, activeCompanyId = '1') => {
  const token = randomBytes(32).toString('base64url');
  await insertSession({
    tokenHash: hashToken(token),
    userId,
    activeCompanyId,
    expiresAt: new Date(Date.now() + sessionDurationMs),
  });
  return token;
};

export const getRequestTokenHash = (request) => {
  const token = getSessionToken(request);
  return token ? hashToken(token) : null;
};

export const getSessionUser = async (request) => {
  const tokenHash = getRequestTokenHash(request);
  if (!tokenHash) return null;
  const session = await findSessionWithUser(tokenHash);
  if (!session) return null;
  if (session.expires_at <= new Date()) {
    await deleteSession(tokenHash);
    return null;
  }

  const user = sessionUserFromRow(session);
  if (user.active === false) {
    await deleteSession(tokenHash);
    return null;
  }
  let activeCompanyId = session.active_company_id;
  const companyIds = getUserCompanyIds(user);
  if (!companyIds.includes(activeCompanyId)) {
    activeCompanyId = companyIds[0];
    await setSessionCompany(tokenHash, activeCompanyId);
  }
  return getSessionUserData(user, activeCompanyId);
};

export const revokeUserSessions = async (userId, { notifyAccessChanged = false } = {}) => {
  const revokedTokens = new Set(await deleteUserSessions(userId));
  if (notifyAccessChanged) {
    sendToEventClients((session) => revokedTokens.has(session.tokenHash), { event: 'user.access_changed' });
  }
  closeEventClients((session) => revokedTokens.has(session.tokenHash));
};
