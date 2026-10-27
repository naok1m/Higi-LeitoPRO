import { appUrl } from '@/lib/basePath';

const STORAGE_PREFIX = 'higi-leito-pro';
const ENTITY_STORAGE_KEY = `${STORAGE_PREFIX}:entities`;
const ENTITY_MIGRATION_KEY = `${STORAGE_PREFIX}:shared-entities-migrated`;

const ENTITY_NAMES = ['Bed', 'CleaningTask', 'Employee', 'Material', 'MaterialCheck', 'Unit'];
let localEntitiesMigration;

/** @typedef {Error & { status?: number; code?: string }} ApiError */

/**
 * @param {string} url
 * @param {{ method?: string; body?: unknown }} options
 */
const apiRequest = async (url, { method = 'GET', body } = {}) => {
  let response;
  try {
    response = await fetch(appUrl(url), {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new Error('Não foi possível acessar o servidor compartilhado. Verifique se o computador principal está ligado.');
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('O servidor compartilhado retornou uma resposta inválida.');
  }
  if (!response.ok) {
    /** @type {ApiError} */
    const error = new Error(payload.error || 'Não foi possível concluir a operação no servidor compartilhado.');
    error.status = response.status;
    error.code = payload.code;
    throw error;
  }
  return payload;
};

const authRequest = (endpoint, body) =>
  apiRequest(`/api/auth/${endpoint}`, { method: body === undefined ? 'GET' : 'POST', body });

const entityRequest = (path, options = {}) =>
  apiRequest(`/api/entities/${path}`, options);

const readStorage = (key, fallback) => {
  const value = window.localStorage.getItem(key);
  if (value === null) return fallback;

  try {
    return JSON.parse(value);
  } catch (error) {
    console.error(`Não foi possível ler os dados locais (${key}).`, error);
    throw new Error('Os dados locais estão inválidos. Verifique o armazenamento do navegador.');
  }
};

const migrateLocalEntities = () => {
  const isHostBrowser = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname);
  if (!isHostBrowser || window.localStorage.getItem(ENTITY_MIGRATION_KEY) === 'done') {
    return Promise.resolve();
  }

  if (!localEntitiesMigration) {
    const entities = readStorage(ENTITY_STORAGE_KEY, {});
    localEntitiesMigration = entityRequest('migrate', { method: 'POST', body: { entities } })
      .then(() => window.localStorage.setItem(ENTITY_MIGRATION_KEY, 'done'))
      .catch((error) => {
        localEntitiesMigration = null;
        throw error;
      });
  }
  return localEntitiesMigration;
};

const entityApi = (name) => ({
  async filter(query = {}, options = {}) {
    await migrateLocalEntities();
    return entityRequest(`${name}/filter`, { method: 'POST', body: { query, options } });
  },

  async create(values) {
    await migrateLocalEntities();
    const { record } = await entityRequest(`${name}/create`, { method: 'POST', body: values });
    return record;
  },

  async update(id, values) {
    await migrateLocalEntities();
    const { record } = await entityRequest(`${name}/record/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: values,
    });
    return record;
  },

  async delete(id) {
    await migrateLocalEntities();
    return entityRequest(`${name}/record/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async aggregate(options) {
    await migrateLocalEntities();
    return entityRequest(`${name}/aggregate`, { method: 'POST', body: options });
  },
});

const auth = {
  async me() {
    const { user } = await authRequest('me');
    return user;
  },

  async loginViaEmailPassword(email, password) {
    const normalizedEmail = email.trim().toLowerCase();
    return (await authRequest('login', { email: normalizedEmail, password })).user;
  },

  async switchCompany(companyId) {
    return (await authRequest('switch-company', { companyId })).user;
  },

  async register({ email, password }) {
    return (await authRequest('bootstrap-admin', { email, password })).user;
  },

  async logout() {
    await authRequest('logout', {});
  },

  async resetPasswordRequest(email) {
    const { resetLink } = await authRequest('reset-request', { email });
    return resetLink;
  },

  async resetPassword({ resetToken, newPassword }) {
    await authRequest('reset-password', { resetToken, newPassword });
  },

  async changeTemporaryPassword(newPassword) {
    await authRequest('change-temporary-password', { newPassword });
  },
};

const admin = {
  async users(filters = {}) {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value !== '' && value !== null && value !== undefined),
    );
    return apiRequest(`/api/admin/users?${query}`);
  },

  async createUser(values) {
    return apiRequest('/api/admin/users', { method: 'POST', body: values });
  },

  async updateUser(id, values) {
    return apiRequest(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: values });
  },

  async updateUserStatus(id, active) {
    return apiRequest(`/api/admin/users/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: { active },
    });
  },

  async resetUserPassword(id) {
    return apiRequest(`/api/admin/users/${encodeURIComponent(id)}/reset-password`, {
      method: 'PATCH',
      body: {},
    });
  },

  async userAudit(id) {
    return apiRequest(`/api/admin/users/${encodeURIComponent(id)}/audit`);
  },
};

const oracle = {
  async status() {
    return apiRequest('/api/oracle/status');
  },

  async dischargeForecast() {
    return apiRequest('/api/oracle/discharge-forecast');
  },

  async occupiedBeds() {
    return apiRequest('/api/oracle/occupied-beds');
  },

  async requestAdHocCleaning(values) {
    return apiRequest('/api/oracle/ad-hoc-cleaning', { method: 'POST', body: values });
  },

  async sync() {
    return apiRequest('/api/oracle/sync', { method: 'POST', body: {} });
  },
};

const workflow = {
  async getIdleLimit() {
    return apiRequest('/api/workflow/idle-limit');
  },

  async updateIdleLimit(idleLimitMinutes, operationLimitMinutes) {
    return apiRequest('/api/workflow/idle-limit', {
      method: 'PUT',
      body: { idleLimitMinutes, operationLimitMinutes },
    });
  },

  async completeReview(taskId) {
    return apiRequest('/api/workflow/complete-review', {
      method: 'POST',
      body: { taskId },
    });
  },

  async confirmMvRelease(taskId) {
    return apiRequest('/api/workflow/confirm-mv-release', {
      method: 'POST',
      body: { taskId },
    });
  },

  async completeManually(taskId, reason) {
    return apiRequest('/api/workflow/complete-manual', {
      method: 'POST',
      body: { taskId, reason },
    });
  },
};

const structure = {
  async purgeManual() {
    return apiRequest('/api/structure/purge-manual', { method: 'POST', body: {} });
  },
};

export const db = {
  auth,
  admin,
  oracle,
  workflow,
  structure,
  entities: Object.fromEntries(ENTITY_NAMES.map((name) => [name, entityApi(name)])),
};

export default db;
