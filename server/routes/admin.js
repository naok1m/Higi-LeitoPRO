import { randomBytes, randomUUID } from 'node:crypto';
import { companyById } from '../config/companies.js';
import { getConfig } from '../config/env.js';
import { withTransaction } from '../db/pool.js';
import { ApiError } from '../http/errors.js';
import { readJsonBody, sendJson } from '../http/io.js';
import { insertUser, listUsers, lockUsers, saveUser } from '../repositories/users.js';
import { listUserAudit, recordUserAudit } from '../repositories/userAudit.js';
import {
  getUserCompanyIds,
  getUserRole,
  publicUser,
  requireAdministrator,
  userRoles,
  validateCompanyIds,
  validateRole,
} from '../services/access.js';
import { getSessionUser, revokeUserSessions } from '../services/authSessions.js';
import { publishChange } from '../services/changes.js';
import { makePasswordCredentials } from '../services/passwords.js';

const makeTemporaryPassword = () => `Higi-${randomBytes(12).toString('base64url')}aA1!`;

const validateName = (name) => {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 200) {
    throw new ApiError(400, 'invalid_name', 'Informe o nome completo (até 200 caracteres).');
  }
  return name.trim();
};

const validateEmail = (email) => {
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    throw new ApiError(400, 'invalid_email', 'Informe um e-mail válido.');
  }
  return email.trim().toLowerCase();
};

const validateRegistration = (registration) => {
  if (registration === undefined || registration === null || registration === '') return '';
  if (typeof registration !== 'string' || registration.trim().length > 40) {
    throw new ApiError(400, 'invalid_registration', 'CPF ou matrícula deve ter até 40 caracteres.');
  }
  return registration.trim();
};

const toAdminUser = (user) => ({
  ...publicUser(user),
  role: getUserRole(user),
  companyIds: getUserCompanyIds(user),
  active: user.active !== false,
  isPrimaryAdmin: Boolean(getConfig().adminBootstrapEmail)
    && user.email === getConfig().adminBootstrapEmail,
  lastLogin: user.lastLogin || null,
  mustChangePassword: user.mustChangePassword === true,
});

const parsePage = (value, fallback, maximum) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? Math.min(parsed, maximum) : fallback;
};

const listUsersPage = async (url) => {
  const params = url.searchParams;
  const search = (params.get('search') || '').trim().toLocaleLowerCase('pt-BR');
  const role = params.get('role') || '';
  const status = params.get('status') || 'all';
  const companyId = params.get('companyId') || '';
  const page = parsePage(params.get('page'), 1, 100000);
  const pageSize = [10, 25, 50].includes(Number(params.get('pageSize')))
    ? Number(params.get('pageSize'))
    : 10;
  if (role && !userRoles.includes(role)) {
    throw new ApiError(400, 'invalid_role', 'Selecione um perfil válido para filtrar.');
  }
  if (!['all', 'active', 'inactive'].includes(status)) {
    throw new ApiError(400, 'invalid_status', 'Selecione um status válido para filtrar.');
  }
  if (companyId && !companyById.has(companyId)) {
    throw new ApiError(400, 'invalid_company', 'Selecione uma empresa válida para filtrar.');
  }

  const matchingUsers = (await listUsers())
    .filter((user) => !search
      || `${user.name || ''} ${user.email}`.toLocaleLowerCase('pt-BR').includes(search))
    .filter((user) => !role || getUserRole(user) === role)
    .filter((user) => status === 'all'
      || (status === 'active' ? user.active !== false : user.active === false))
    .filter((user) => !companyId || getUserCompanyIds(user).includes(companyId));
  const total = matchingUsers.length;
  const pageCount = Math.ceil(total / pageSize);
  const currentPage = Math.min(page, Math.max(pageCount, 1));
  const users = matchingUsers
    .slice((currentPage - 1) * pageSize, currentPage * pageSize)
    .map(toAdminUser);

  return { users, pagination: { page: currentPage, pageSize, total, pageCount } };
};

const createUser = async ({ actor, values }) => {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new ApiError(400, 'invalid_user', 'Informe os dados do usuário.');
  }
  const name = validateName(values.name);
  const email = validateEmail(values.email);
  const role = values.role;
  validateRole(role);
  const registration = validateRegistration(values.registration);
  const companyIds = role === 'admin'
    ? getUserCompanyIds(actor)
    : validateCompanyIds(values.companyIds ?? [actor.activeCompanyId], actor);
  const temporaryPassword = values.password || makeTemporaryPassword();
  if (typeof temporaryPassword !== 'string' || temporaryPassword.length < 6) {
    throw new ApiError(400, 'weak_password', 'A senha inicial deve ter pelo menos 6 caracteres.');
  }
  const credentials = await makePasswordCredentials(temporaryPassword);
  const user = {
    id: randomUUID(),
    email,
    role,
    name,
    registration,
    companyIds,
    active: true,
    mustChangePassword: !values.password,
    ...credentials,
  };

  await withTransaction(async (client) => {
    await lockUsers(client);
    if ((await listUsers(client)).some((item) => item.email === email)) {
      throw new ApiError(409, 'account_exists', 'Já existe uma conta com este e-mail.');
    }
    await insertUser(user, client);
    await recordUserAudit({
      userId: user.id,
      actor,
      action: 'created',
      details: { changedFields: ['name', 'email', 'role', 'registration', 'companyIds', 'active'] },
    }, client);
  });
  return { user: toAdminUser(user), temporaryPassword };
};

const updateUser = async ({ userId, values, actor }) => {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new ApiError(400, 'invalid_user_update', 'Informe os dados que deseja alterar.');
  }
  if (Object.keys(values).length === 0
    || !['name', 'email', 'role', 'registration', 'companyIds', 'active'].some((key) => values[key] !== undefined)) {
    throw new ApiError(400, 'invalid_user_update', 'Informe os dados que deseja alterar.');
  }
  if (values.role !== undefined) validateRole(values.role);
  if (values.active !== undefined && typeof values.active !== 'boolean') {
    throw new ApiError(400, 'invalid_user_update', 'O estado da conta deve ser ativo ou inativo.');
  }
  if (values.companyIds !== undefined) validateCompanyIds(values.companyIds, actor);
  if (values.name !== undefined) values.name = validateName(values.name);
  if (values.email !== undefined) values.email = validateEmail(values.email);
  if (values.registration !== undefined) values.registration = validateRegistration(values.registration);

  const result = await withTransaction(async (client) => {
    await lockUsers(client);
    const users = await listUsers(client);
    const user = users.find((item) => item.id === userId);
    if (!user) throw new ApiError(404, 'user_not_found', 'Usuário não encontrado.');

    const configuredAdminEmail = getConfig().adminBootstrapEmail;
    if (values.email !== undefined && user.email === configuredAdminEmail && values.email !== user.email) {
      throw new ApiError(409, 'primary_admin_email_locked', 'O e-mail do administrador principal não pode ser alterado.');
    }
    const nextRole = values.role ?? getUserRole(user);
    const nextActive = values.active ?? user.active !== false;
    const nextCompanyIds = nextRole === 'admin'
      ? getUserCompanyIds(actor)
      : values.companyIds === undefined ? getUserCompanyIds(user) : [...values.companyIds];
    const removingAdmin = getUserRole(user) === 'admin' && (nextRole !== 'admin' || !nextActive);
    if (removingAdmin && users.filter((item) => getUserRole(item) === 'admin' && item.active !== false).length <= 1) {
      throw new ApiError(409, 'last_admin', 'Mantenha ao menos um administrador ativo.');
    }
    if (user.id === actor.id && (nextRole !== 'admin' || !nextActive
      || nextCompanyIds.length !== getUserCompanyIds(user).length
      || nextCompanyIds.some((id) => !getUserCompanyIds(user).includes(id)))) {
      throw new ApiError(409, 'cannot_change_self', 'Não é possível remover seu próprio acesso de administrador.');
    }
    const nextEmail = values.email ?? user.email;
    if (users.some((item) => item.id !== userId && item.email === nextEmail)) {
      throw new ApiError(409, 'account_exists', 'Já existe uma conta com este e-mail.');
    }

    const changedFields = [];
    for (const field of ['name', 'email', 'registration']) {
      if (values[field] !== undefined && values[field] !== (user[field] || '')) {
        user[field] = values[field];
        changedFields.push(field);
      }
    }
    if (values.role !== undefined && nextRole !== getUserRole(user)) changedFields.push('role');
    if (values.active !== undefined && nextActive !== (user.active !== false)) changedFields.push('active');
    if (values.companyIds !== undefined) {
      const currentCompanyIds = getUserCompanyIds(user);
      if (nextCompanyIds.length !== currentCompanyIds.length
        || nextCompanyIds.some((id) => !currentCompanyIds.includes(id))) changedFields.push('companyIds');
    }
    user.role = nextRole;
    user.active = nextActive;
    user.companyIds = nextCompanyIds;
    await saveUser(user, client);
    if (changedFields.length) {
      await recordUserAudit({
        userId,
        actor,
        action: 'updated',
        details: { changedFields },
      }, client);
    }
    const accessChanged = changedFields.some((field) => ['role', 'active', 'companyIds'].includes(field));
    return { user: toAdminUser(user), accessChanged, changedFields };
  });

  if (result.accessChanged) await revokeUserSessions(userId, { notifyAccessChanged: true });
  if (result.changedFields.length) {
    await publishChange({ event: 'user.updated', user: result.user, actor });
  }
  return result;
};

const handleAdminRoute = async (request, response, url, actor) => {
  requireAdministrator(actor);

  if (request.method === 'GET' && url.pathname === '/api/admin/users') {
    sendJson(response, 200, await listUsersPage(url));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/admin/users') {
    const values = await readJsonBody(request);
    const { user, temporaryPassword } = await createUser({ actor, values });
    await publishChange({ event: 'user.created', user, actor });
    sendJson(response, 201, { user, temporaryPassword });
    return;
  }

  const auditMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/audit$/);
  if (request.method === 'GET' && auditMatch) {
    const userId = decodeURIComponent(auditMatch[1]);
    if (!(await listUsers()).some((user) => user.id === userId)) {
      throw new ApiError(404, 'user_not_found', 'Usuário não encontrado.');
    }
    sendJson(response, 200, { events: await listUserAudit(userId) });
    return;
  }

  const resetMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/reset-password$/);
  if (request.method === 'PATCH' && resetMatch) {
    const userId = decodeURIComponent(resetMatch[1]);
    if (userId === actor.id) {
      throw new ApiError(409, 'cannot_reset_self', 'Use o fluxo de redefinição de senha para sua própria conta.');
    }
    const temporaryPassword = makeTemporaryPassword();
    const credentials = await makePasswordCredentials(temporaryPassword);
    const user = await withTransaction(async (client) => {
      await lockUsers(client);
      const existing = (await listUsers(client)).find((item) => item.id === userId);
      if (!existing) throw new ApiError(404, 'user_not_found', 'Usuário não encontrado.');
      Object.assign(existing, credentials, { mustChangePassword: true });
      await saveUser(existing, client);
      await recordUserAudit({
        userId,
        actor,
        action: 'password_reset',
        details: { mustChangePassword: true },
      }, client);
      return toAdminUser(existing);
    });
    await revokeUserSessions(userId);
    await publishChange({ event: 'user.password_reset', user, actor });
    sendJson(response, 200, { user, temporaryPassword });
    return;
  }

  const statusMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/status$/);
  if (request.method === 'PATCH' && statusMatch) {
    const userId = decodeURIComponent(statusMatch[1]);
    const { active } = await readJsonBody(request);
    const result = await updateUser({ userId, values: { active }, actor });
    sendJson(response, 200, { user: result.user });
    return;
  }

  const match = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (['PATCH', 'PUT'].includes(request.method) && match) {
    const userId = decodeURIComponent(match[1]);
    const result = await updateUser({ userId, values: await readJsonBody(request), actor });
    sendJson(response, 200, { user: result.user });
    return;
  }

  throw new ApiError(404, 'not_found', 'Rota de gerenciamento de usuários não encontrada.');
};

export const adminHandler = async (request, response, url) => {
  const actor = await getSessionUser(request);
  if (!actor) throw new ApiError(401, 'unauthorized', 'Entre como administrador para gerenciar usuários.');
  await handleAdminRoute(request, response, url, actor);
};
