import { randomBytes, randomUUID } from 'node:crypto';
import { companies, companyById } from '../config/companies.js';
import { getConfig } from '../config/env.js';
import { withTransaction } from '../db/pool.js';
import { ApiError } from '../http/errors.js';
import { clearSessionCookie, isHostConnection, readJsonBody, sendJson, setSessionCookie } from '../http/io.js';
import { consumeResetToken, replaceUserResetToken } from '../repositories/resetTokens.js';
import { deleteSession, hashToken, setSessionCompany } from '../repositories/sessions.js';
import {
  findUserByEmail,
  findUserById,
  insertUser,
  listUsers,
  lockUsers,
  saveUser,
} from '../repositories/users.js';
import { getSessionUserData, getUserCompanyIds, getUserRole, publicUser } from '../services/access.js';
import { createSession, getRequestTokenHash, getSessionUser, revokeUserSessions } from '../services/authSessions.js';
import { publishChange } from '../services/changes.js';
import { makePasswordCredentials, passwordsMatch } from '../services/passwords.js';
import { closeEventClients } from '../services/realtime.js';

export const authHandler = async (request, response, url) => {
  if (request.method === 'GET' && url.pathname === '/api/auth/me') {
    sendJson(response, 200, { user: await getSessionUser(request) });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/switch-company') {
    const actor = await getSessionUser(request);
    if (!actor) {
      throw new ApiError(401, 'unauthorized', 'Entre na sua conta para trocar de empresa.');
    }
    const { companyId } = await readJsonBody(request);
    if (typeof companyId !== 'string' || !companyById.has(companyId)) {
      throw new ApiError(400, 'invalid_company', 'Selecione uma empresa válida.');
    }
    if (!actor.companyIds.includes(companyId)) {
      throw new ApiError(403, 'forbidden', 'Sua conta não tem acesso a essa empresa.');
    }
    await setSessionCompany(getRequestTokenHash(request), companyId);
    sendJson(response, 200, {
      user: getSessionUserData(actor, companyId),
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/bootstrap-admin') {
    if (!isHostConnection(request)) {
      throw new ApiError(403, 'host_only', 'O primeiro administrador deve ser configurado no computador host.');
    }
    const { adminBootstrapEmail } = getConfig();
    if (!adminBootstrapEmail) {
      throw new ApiError(503, 'admin_not_configured', 'O TI precisa configurar HIGI_ADMIN_EMAIL no arquivo .env do servidor.');
    }
    const { email, password } = await readJsonBody(request);
    if (typeof password !== 'string' || password.length < 6) {
      throw new ApiError(400, 'weak_password', 'A senha deve ter pelo menos 6 caracteres.');
    }
    if (typeof email !== 'string' || email.trim().toLowerCase() !== adminBootstrapEmail) {
      throw new ApiError(403, 'bootstrap_email_mismatch', 'Use o e-mail de administrador configurado pelo TI.');
    }

    const user = await withTransaction(async (client) => {
      await lockUsers(client);
      const users = await listUsers(client);
      if (users.some((item) => getUserRole(item) === 'admin')) {
        throw new ApiError(409, 'admin_already_configured', 'O administrador inicial já foi configurado.');
      }
      const existingUser = users.find((item) => item.email === adminBootstrapEmail);
      if (existingUser) {
        if (existingUser.active === false || !(await passwordsMatch(password, existingUser))) {
          throw new ApiError(401, 'invalid_credentials', 'E-mail ou senha inválidos.');
        }
        existingUser.role = 'admin';
        existingUser.companyIds = companies.map(({ id }) => id);
        await saveUser(existingUser, client);
        return existingUser;
      }

      const newUser = {
        id: randomUUID(),
        email: adminBootstrapEmail,
        role: 'admin',
        companyIds: companies.map(({ id }) => id),
        active: true,
        ...await makePasswordCredentials(password),
      };
      await insertUser(newUser, client);
      return newUser;
    });
    const token = await createSession(user.id, '1');
    const safeUser = { ...getSessionUserData(user, '1'), active: true };
    await publishChange({ event: 'user.admin_bootstrapped', user: safeUser, actor: safeUser });
    sendJson(response, 201, { user: safeUser }, { 'Set-Cookie': setSessionCookie(token) });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/register') {
    throw new ApiError(403, 'admin_creation_required', 'Novas contas devem ser criadas por um administrador.');
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/login') {
    const { email, password } = await readJsonBody(request);
    if (typeof email !== 'string' || typeof password !== 'string') {
      throw new ApiError(400, 'invalid_credentials', 'Informe e-mail e senha.');
    }
    const user = await findUserByEmail(email.trim().toLowerCase());
    if (!user) throw new ApiError(404, 'account_not_found', 'E-mail ou senha inválidos.');
    if (user.active === false) throw new ApiError(403, 'account_inactive', 'Esta conta foi desativada. Procure o administrador de TI.');
    if (!(await passwordsMatch(password, user))) {
      throw new ApiError(401, 'invalid_credentials', 'E-mail ou senha inválidos.');
    }

    const activeCompanyId = getUserCompanyIds(user)[0];
    const token = await createSession(user.id, activeCompanyId);
    sendJson(response, 200, {
      user: { ...getSessionUserData(user, activeCompanyId), active: true },
    }, { 'Set-Cookie': setSessionCookie(token) });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
    const tokenHash = getRequestTokenHash(request);
    if (tokenHash) {
      await deleteSession(tokenHash);
      closeEventClients((session) => session.tokenHash === tokenHash);
    }
    sendJson(response, 200, { success: true }, { 'Set-Cookie': clearSessionCookie() });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/reset-request') {
    if (!isHostConnection(request)) {
      throw new ApiError(403, 'host_only', 'Por segurança, gere o link de redefinição no computador que hospeda o app.');
    }
    const { email } = await readJsonBody(request);
    if (typeof email !== 'string') throw new ApiError(400, 'invalid_email', 'Informe um e-mail válido.');
    const user = await findUserByEmail(email.trim().toLowerCase());
    if (!user) throw new ApiError(404, 'account_not_found', 'Não existe uma conta com este e-mail.');
    const token = randomBytes(32).toString('hex');
    await withTransaction((client) => replaceUserResetToken({
      tokenHash: hashToken(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    }, client));
    sendJson(response, 200, { resetLink: `/reset-password?token=${encodeURIComponent(token)}` });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/reset-password') {
    const { resetToken, newPassword } = await readJsonBody(request);
    if (typeof resetToken !== 'string') throw new ApiError(400, 'invalid_reset_token', 'O link de redefinição é inválido ou expirou.');
    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      throw new ApiError(400, 'weak_password', 'A senha deve ter pelo menos 6 caracteres.');
    }
    const credentials = await makePasswordCredentials(newPassword);
    const resetUser = await withTransaction(async (client) => {
      await lockUsers(client);
      const userId = await consumeResetToken(hashToken(resetToken), client);
      if (!userId) throw new ApiError(400, 'invalid_reset_token', 'O link de redefinição é inválido ou expirou.');
      const user = await findUserById(userId, client);
      if (!user) throw new ApiError(404, 'account_not_found', 'A conta não foi encontrada.');
      Object.assign(user, credentials);
      await saveUser(user, client);
      return { ...publicUser(user), role: getUserRole(user) };
    });
    await revokeUserSessions(resetUser.id);
    await publishChange({ event: 'user.password_reset', user: resetUser, actor: resetUser });
    sendJson(response, 200, { success: true });
    return;
  }

  throw new ApiError(404, 'not_found', 'Rota de autenticação não encontrada.');
};
