import { randomUUID } from 'node:crypto';
import { companies } from '../config/companies.js';
import { withTransaction } from '../db/pool.js';
import { ApiError } from '../http/errors.js';
import { readJsonBody, sendJson } from '../http/io.js';
import { insertUser, listUsers, lockUsers, saveUser } from '../repositories/users.js';
import {
  getUserCompanyIds,
  getUserRole,
  publicUser,
  requireAdministrator,
  validateCompanyIds,
  validateRole,
} from '../services/access.js';
import { getSessionUser, revokeUserSessions } from '../services/authSessions.js';
import { publishChange } from '../services/changes.js';
import { makePasswordCredentials } from '../services/passwords.js';

const createUser = async ({ email, password, role, companyIds }) => {
  validateRole(role);
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new ApiError(400, 'invalid_email', 'Informe um e-mail válido.');
  }
  if (typeof password !== 'string' || password.length < 6) {
    throw new ApiError(400, 'weak_password', 'A senha deve ter pelo menos 6 caracteres.');
  }

  const normalizedEmail = email.trim().toLowerCase();
  const credentials = await makePasswordCredentials(password);
  const user = {
    id: randomUUID(),
    email: normalizedEmail,
    role,
    companyIds: role === 'admin' ? companies.map(({ id }) => id) : companyIds,
    active: true,
    ...credentials,
  };

  await withTransaction(async (client) => {
    await lockUsers(client);
    if ((await listUsers(client)).some((item) => item.email === normalizedEmail)) {
      throw new ApiError(409, 'account_exists', 'Já existe uma conta com este e-mail.');
    }
    await insertUser(user, client);
  });
  return user;
};

const handleAdminRoute = async (request, response, url, actor) => {
  requireAdministrator(actor);

  if (request.method === 'GET' && url.pathname === '/api/admin/users') {
    const users = (await listUsers()).map((user) => ({
      ...publicUser(user),
      role: getUserRole(user),
      companyIds: getUserCompanyIds(user),
      active: user.active !== false,
    }));
    sendJson(response, 200, { users });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/admin/users') {
    const { email, password, role, companyIds } = await readJsonBody(request);
    validateRole(role);
    const assignedCompanyIds = role === 'admin'
      ? getUserCompanyIds(actor)
      : validateCompanyIds(companyIds ?? [actor.activeCompanyId], actor);
    const user = await createUser({ email, password, role, companyIds: assignedCompanyIds });
    const safeUser = { ...publicUser(user), companyIds: assignedCompanyIds, active: true };
    await publishChange({ event: 'user.created', user: safeUser, actor });
    sendJson(response, 201, { user: safeUser });
    return;
  }

  const match = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (request.method === 'PATCH' && match) {
    const userId = decodeURIComponent(match[1]);
    const { role, active, companyIds } = await readJsonBody(request);
    if (role === undefined && active === undefined && companyIds === undefined) {
      throw new ApiError(400, 'invalid_user_update', 'Informe um perfil ou estado para alterar.');
    }
    if (role !== undefined) validateRole(role);
    if (companyIds !== undefined) validateCompanyIds(companyIds, actor);
    if (active !== undefined && typeof active !== 'boolean') {
      throw new ApiError(400, 'invalid_user_update', 'O estado da conta deve ser ativo ou inativo.');
    }
    const { user: updatedUser, accessChanged } = await withTransaction(async (client) => {
      await lockUsers(client);
      const users = await listUsers(client);
      const user = users.find((item) => item.id === userId);
      if (!user) throw new ApiError(404, 'user_not_found', 'Usuário não encontrado.');
      const nextRole = role ?? getUserRole(user);
      const nextActive = active ?? user.active !== false;
      const nextCompanyIds = nextRole === 'admin'
        ? getUserCompanyIds(actor)
        : companyIds === undefined ? getUserCompanyIds(user) : [...companyIds];
      const removingAdmin = getUserRole(user) === 'admin' && (nextRole !== 'admin' || !nextActive);
      if (removingAdmin && users.filter((item) => getUserRole(item) === 'admin' && item.active !== false).length <= 1) {
        throw new ApiError(409, 'last_admin', 'Mantenha ao menos um administrador ativo.');
      }
      if (user.id === actor.id && (nextRole !== 'admin' || !nextActive
        || nextCompanyIds.length !== getUserCompanyIds(user).length
        || nextCompanyIds.some((id) => !getUserCompanyIds(user).includes(id)))) {
        throw new ApiError(409, 'cannot_change_self', 'Não é possível remover seu próprio acesso de administrador.');
      }
      const currentCompanyIds = getUserCompanyIds(user);
      const changed = nextRole !== getUserRole(user) || nextActive !== (user.active !== false)
        || nextCompanyIds.length !== currentCompanyIds.length
        || nextCompanyIds.some((id) => !currentCompanyIds.includes(id));
      if (role !== undefined) user.role = role;
      if (active !== undefined) user.active = active;
      user.companyIds = nextCompanyIds;
      await saveUser(user, client);
      return {
        user: { ...publicUser(user), role: getUserRole(user), active: user.active !== false },
        accessChanged: changed,
      };
    });
    if (accessChanged) await revokeUserSessions(userId, { notifyAccessChanged: true });
    await publishChange({ event: 'user.updated', user: updatedUser, actor });
    sendJson(response, 200, { user: updatedUser });
    return;
  }

  throw new ApiError(404, 'not_found', 'Rota de gerenciamento de usuários não encontrada.');
};

export const adminHandler = async (request, response, url) => {
  const actor = await getSessionUser(request);
  if (!actor) throw new ApiError(401, 'unauthorized', 'Entre como administrador para gerenciar usuários.');
  await handleAdminRoute(request, response, url, actor);
};
