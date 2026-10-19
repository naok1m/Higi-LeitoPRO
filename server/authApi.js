import { createHmac, randomBytes, randomUUID, pbkdf2 as pbkdf2Callback, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  closeOraclePool,
  configureOracleIntegration,
  fetchOracleCleaningBeds,
  getOracleCompanyCodes,
  getOraclePollIntervalMs,
  isOracleConfigured,
  releaseOracleBed,
} from './oracleIntegration.js';
import { getAdvanceWorkflowChanges } from '../src/lib/bedWorkflow.js';

const pbkdf2 = promisify(pbkdf2Callback);
const passwordIterations = 310000;
const sessionDurationMs = 12 * 60 * 60 * 1000;
const cookieName = 'higi_session';
const dataDirectory = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'HigiLeitoPro')
  : path.join(process.env.XDG_DATA_HOME || path.join(homedir(), '.local', 'share'), 'HigiLeitoPro');
const databasePath = path.join(dataDirectory, 'users.json');
const sessions = new Map();
let databaseQueue = Promise.resolve();
const entityNames = ['Bed', 'CleaningTask', 'Employee', 'Material', 'MaterialCheck', 'Unit'];
const userRoles = ['admin', 'manager', 'collaborator', 'rouparia'];
const companies = [
  { id: '1', name: 'Otoclínica', oracleCode: 1 },
  { id: '18', name: 'Gastroclínica', oracleCode: 18 },
  { id: '19', name: 'São Mateus', oracleCode: 19 },
];
const companyById = new Map(companies.map((company) => [company.id, company]));
const supportedOracleCompanyCodes = companies.map(({ oracleCode }) => oracleCode);
const eventClients = new Map();
let webhookUrl = '';
let webhookSecret = '';
let adminBootstrapEmail = '';
const NO_DATABASE_CHANGE = Symbol('no-database-change');
let oraclePollTimer = null;
let oracleSyncPromise = null;
let oracleLastSync = {
  attemptedAt: null,
  succeededAt: null,
  error: null,
  imported: 0,
  updated: 0,
};

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const configureWebhook = (url = '', secret = '') => {
  if (url) {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error('HIGI_WEBHOOK_URL deve conter uma URL válida.');
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('HIGI_WEBHOOK_URL deve usar HTTP ou HTTPS.');
    }
    if (parsedUrl.username || parsedUrl.password) {
      throw new Error('Não inclua credenciais na HIGI_WEBHOOK_URL; configure HIGI_WEBHOOK_SECRET.');
    }
  }
  if (secret && !url) throw new Error('HIGI_WEBHOOK_SECRET exige HIGI_WEBHOOK_URL.');
  webhookUrl = url;
  webhookSecret = secret;
};

export const configureAdminBootstrap = (email = '') => {
  adminBootstrapEmail = email.trim().toLowerCase();
};

export const configureOracle = (env) => {
  configureOracleIntegration(env);
};

export const startOraclePolling = (server) => {
  if (oraclePollTimer) return;
  if (!isOracleConfigured()) return;
  let lastLoggedError = null;
  const poll = () => {
    void syncOracleCleaningBeds().catch((error) => {
      const message = error.message || 'Falha desconhecida na sincronização Oracle.';
      if (message !== lastLoggedError) {
        console.error('A sincronização Oracle falhou.', error);
        lastLoggedError = message;
      }
    });
  };
  poll();
  oraclePollTimer = setInterval(poll, getOraclePollIntervalMs());
  server?.once('close', () => {
    clearInterval(oraclePollTimer);
    oraclePollTimer = null;
    void closeOraclePool().catch((error) => {
      console.error('Não foi possível encerrar o pool de conexões Oracle.', error);
    });
  });
};

const getOracleStatus = () => ({
  configured: isOracleConfigured(),
  pollIntervalMs: isOracleConfigured() ? getOraclePollIntervalMs() : null,
  ...oracleLastSync,
});

const stringValue = (value) => (value === null || value === undefined ? '' : String(value).trim());

const normalizeOracleCleaningRow = (row, companyCode) => {
  const company = companies.find((item) => item.oracleCode === companyCode);
  if (!company) throw new Error(`Código de empresa Oracle não suportado: ${companyCode}.`);
  const unitCode = stringValue(row.CD_UNID_INT) || stringValue(row.CD_SETOR);
  const unitName = stringValue(row.UNIDADE_INTERNACAO)
    || stringValue(row.SETOR)
    || stringValue(row.DS_ENFERMARIA)
    || `Unidade ${unitCode || 'Oracle'}`;
  const bedOracleCode = stringValue(row.CD_LEITO);
  if (!bedOracleCode) return null;
  const requestId = stringValue(row.CD_SOLIC_LIMPEZA);
  const requestedAt = row.DH_SOLICITACAO instanceof Date
    ? row.DH_SOLICITACAO.toISOString()
    : stringValue(row.DH_SOLICITACAO) || null;
  const rawCleaningType = stringValue(row.DS_TIPO_LIMPEZA).toLowerCase();
  const cleaningType = rawCleaningType.includes('concorrente')
    ? 'concorrente'
    : rawCleaningType.includes('terminal') ? 'terminal' : null;
  const unitId = `oracle-unit-${companyCode}-${unitCode || unitName.toLowerCase()}`;

  return {
    unit: {
      id: unitId,
      company_id: company.id,
      name: unitName,
      code: unitCode,
      oracle_source: 'oracle',
      oracle_company_code: companyCode,
      oracle_unit_code: unitCode,
    },
    bed: {
      id: `oracle-bed-${companyCode}-${bedOracleCode}`,
      company_id: company.id,
      code: stringValue(row.DS_LEITO) || bedOracleCode,
      unit_id: unitId,
      unit_name: unitName,
      status: 'aguardando_limpeza',
      oracle_source: 'oracle',
      oracle_company_code: companyCode,
      oracle_cd_leito: bedOracleCode,
      oracle_request_id: requestId || null,
      oracle_request_type: stringValue(row.TP_SOLICITACAO) || null,
      oracle_cleaning_type: cleaningType,
      oracle_requested_at: requestedAt,
      oracle_extra: stringValue(row.SN_EXTRA) || null,
      oracle_accommodation_type: stringValue(row.TIPO_ACOMODACAO) || null,
      oracle_sector_code: stringValue(row.CD_SETOR) || null,
      oracle_sector_name: stringValue(row.SETOR) || null,
      oracle_mv_stage: stringValue(row.ETAPA_MV) || null,
      oracle_request_missing: !requestId,
    },
  };
};

const upsertOracleCleaningBeds = async (rows, companyCode) => updateDatabase((database) => {
  let imported = 0;
  let updated = 0;
  let changed = false;
  const units = getEntityRecords(database, 'Unit');
  const beds = getEntityRecords(database, 'Bed');
  const activeTasks = getEntityRecords(database, 'CleaningTask').filter((task) => task.status === 'em_andamento');
  const normalized = rows.map((row) => normalizeOracleCleaningRow(row, companyCode)).filter(Boolean);

  for (const item of normalized) {
    const unit = units.find((record) => record.id === item.unit.id);
    if (unit) {
      const unitChanged = Object.entries(item.unit).some(([field, value]) => unit[field] !== value);
      if (unitChanged) {
        Object.assign(unit, item.unit, { updated_date: new Date().toISOString() });
        changed = true;
      }
    } else {
      units.push({ ...item.unit, created_date: new Date().toISOString(), updated_date: new Date().toISOString() });
      changed = true;
    }

    let bed = beds.find((record) =>
      record.oracle_source === 'oracle'
      && record.oracle_company_code === item.bed.oracle_company_code
      && record.oracle_cd_leito === item.bed.oracle_cd_leito);
    if (!bed) {
      bed = beds.find((record) =>
        record.code === item.bed.code
        && record.unit_name === item.bed.unit_name
        && getRecordCompanyId(record) === item.bed.company_id
        && !record.oracle_cd_leito);
    }
    if (!bed) {
      const requestedAt = item.bed.oracle_requested_at || new Date().toISOString();
      beds.push({
        ...item.bed,
        created_date: new Date().toISOString(),
        updated_date: requestedAt,
      });
      imported += 1;
      changed = true;
      continue;
    }

    const activeTask = activeTasks.find((task) =>
      task.bed_id === bed.id && getRecordCompanyId(task) === item.bed.company_id);
    const requestChanged = stringValue(bed.oracle_request_id) !== stringValue(item.bed.oracle_request_id);
    if (activeTask && requestChanged) continue;

    const previousStatus = bed.status;
    const bedValues = {
      ...item.bed,
      id: bed.id,
      created_date: bed.created_date,
      status: requestChanged ? item.bed.status : previousStatus,
    };
    const bedChanged = Object.entries(bedValues).some(([field, value]) => bed[field] !== value);
    if (bedChanged) {
      const updatedAt = requestChanged
        ? item.bed.oracle_requested_at || new Date().toISOString()
        : bed.updated_date;
      Object.assign(bed, bedValues, { updated_date: updatedAt });
      updated += 1;
      changed = true;
    }
  }

  if (!changed) return NO_DATABASE_CHANGE;
  database.entities.Unit = units;
  database.entities.Bed = beds;
  return { imported, updated };
});

const performOracleCleaningSync = async (companyCodes = getOracleCompanyCodes()) => {
  oracleLastSync = { ...oracleLastSync, attemptedAt: new Date().toISOString(), error: null };
  try {
    if (companyCodes.some((code) => !supportedOracleCompanyCodes.includes(code))) {
      throw new Error('A integração Oracle inclui um código de empresa que não está cadastrado no sistema.');
    }
    let imported = 0;
    let updated = 0;
    for (const companyCode of companyCodes) {
      const rows = await fetchOracleCleaningBeds(companyCode);
      const result = await upsertOracleCleaningBeds(rows, companyCode);
      imported += result?.imported || 0;
      updated += result?.updated || 0;
    }
    oracleLastSync = {
      attemptedAt: oracleLastSync.attemptedAt,
      succeededAt: new Date().toISOString(),
      error: null,
      imported,
      updated,
    };
    return oracleLastSync;
  } catch (error) {
    oracleLastSync = {
      ...oracleLastSync,
      error: error.message || 'Não foi possível consultar o Oracle.',
    };
    throw error;
  }
};

const syncOracleCleaningBeds = (companyCodes = getOracleCompanyCodes()) => {
  if (!oracleSyncPromise) {
    oracleSyncPromise = performOracleCleaningSync(companyCodes).finally(() => {
      oracleSyncPromise = null;
    });
  }
  return oracleSyncPromise;
};

const deliverWebhook = async (event) => {
  if (!webhookUrl) return;

  const body = JSON.stringify(event);
  const signature = webhookSecret
    ? `sha256=${createHmac('sha256', webhookSecret).update(body).digest('hex')}`
    : null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Higi-Event': event.event,
          'X-Higi-Delivery': event.id,
          ...(signature ? { 'X-Higi-Signature': signature } : {}),
        },
        body,
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        const status = response.status;
        await response.body?.cancel();
        throw new Error(`O webhook respondeu com HTTP ${status}.`);
      }
      await response.body?.cancel();
      return;
    } catch (error) {
      if (attempt === 3) {
        console.error(`Não foi possível entregar o evento ${event.id} ao webhook após 3 tentativas.`, error);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
};

const publishChange = (event) => {
  const payload = {
    id: randomUUID(),
    source: 'higi-leito-pro',
    occurredAt: new Date().toISOString(),
    ...event,
  };
  const liveUpdate = `event: change\ndata: ${JSON.stringify({
    id: payload.id,
    event: payload.event,
    occurredAt: payload.occurredAt,
  })}\n\n`;
  for (const client of eventClients.keys()) client.write(liveUpdate);
  void deliverWebhook(payload);
};

const readDatabase = async () => {
  try {
    const database = JSON.parse(await readFile(databasePath, 'utf8'));
    if (!Array.isArray(database.users)) {
      throw new Error('Formato inválido no banco local de usuários.');
    }
    database.resetTokens = Array.isArray(database.resetTokens) ? database.resetTokens : [];
    database.entities = database.entities && typeof database.entities === 'object' && !Array.isArray(database.entities)
      ? database.entities
      : {};
    database.entitiesMigrated = Boolean(database.entitiesMigrated);
    return database;
  } catch (error) {
    if (error.code === 'ENOENT') return { users: [], resetTokens: [], entities: {}, entitiesMigrated: false };
    throw error;
  }
};

const updateDatabase = async (update) => {
  let release;
  const previousUpdate = databaseQueue;
  databaseQueue = new Promise((resolve) => { release = resolve; });
  await previousUpdate;

  try {
    const database = await readDatabase();
    const result = await update(database);
    if (result === NO_DATABASE_CHANGE) return null;
    await mkdir(dataDirectory, { recursive: true });
    const temporaryPath = `${databasePath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(database, null, 2), { mode: 0o600 });
    await rename(temporaryPath, databasePath);
    return result;
  } finally {
    release();
  }
};

const publicUser = ({ passwordHash, passwordSalt, ...user }) => user;

const getUserRole = (user) => user.role === 'user' ? 'manager' : user.role;
const getUserCompanyIds = (user) => {
  if (getUserRole(user) === 'admin') return companies.map(({ id }) => id);
  const assigned = Array.isArray(user.companyIds)
    ? [...new Set(user.companyIds.filter((id) => companyById.has(id)))]
    : [];
  return assigned.length ? assigned : ['1'];
};
const getSessionUserData = (user, activeCompanyId) => {
  const companyIds = getUserCompanyIds(user);
  const activeId = companyIds.includes(activeCompanyId) ? activeCompanyId : companyIds[0];
  return {
    ...publicUser(user),
    role: getUserRole(user),
    companyIds,
    companies: companyIds.map((id) => companyById.get(id)),
    activeCompanyId: activeId,
  };
};
const getRecordCompanyId = (record) =>
  String(record.company_id || record.oracle_company_code || '1');
const getCompanyRecords = (database, entity, companyId) =>
  getEntityRecords(database, entity)
    .filter((record) => getRecordCompanyId(record) === companyId);
const getTenantRecords = (database, entity, actor) =>
  getCompanyRecords(database, entity, actor.activeCompanyId);
const validateCompanyIds = (companyIds, actor) => {
  if (!Array.isArray(companyIds) || companyIds.length === 0
    || companyIds.some((id) => typeof id !== 'string' || !companyById.has(id))
    || new Set(companyIds).size !== companyIds.length) {
    throw new ApiError(400, 'invalid_companies', 'Selecione ao menos uma empresa válida para o usuário.');
  }
  const actorCompanyIds = getUserCompanyIds(actor);
  if (companyIds.some((id) => !actorCompanyIds.includes(id))) {
    throw new ApiError(403, 'forbidden', 'Não é possível atribuir uma empresa sem acesso autorizado.');
  }
  return [...companyIds];
};
const assertActiveCompany = (companyId, actor) => {
  if (companyId !== undefined && String(companyId) !== actor.activeCompanyId) {
    throw new ApiError(403, 'company_mismatch', 'O registro deve pertencer à empresa ativa.');
  }
};

const hashPassword = async (password, salt) =>
  (await pbkdf2(password, salt, passwordIterations, 64, 'sha512')).toString('hex');

const makePasswordCredentials = async (password) => {
  const passwordSalt = randomBytes(16).toString('hex');
  return { passwordSalt, passwordHash: await hashPassword(password, passwordSalt) };
};

const passwordsMatch = async (password, user) => {
  const candidate = Buffer.from(await hashPassword(password, user.passwordSalt), 'hex');
  const expected = Buffer.from(user.passwordHash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
};

const sendJson = (response, status, body, headers = {}) => {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  response.end(JSON.stringify(body));
};

const readJsonBody = async (request, maxSize = 16 * 1024) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxSize) throw new ApiError(413, 'request_too_large', 'A solicitação excede o limite permitido.');
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError(400, 'invalid_json', 'A solicitação não contém JSON válido.');
  }
};

const getSessionToken = (request) => {
  const cookies = (request.headers.cookie || '').split(';');
  const sessionCookie = cookies.find((cookie) => cookie.trim().startsWith(`${cookieName}=`));
  return sessionCookie?.trim().slice(cookieName.length + 1) || null;
};

const setSessionCookie = (token) =>
  `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(sessionDurationMs / 1000)}`;

const clearSessionCookie = `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;

const isHostConnection = (request) =>
  ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress);

const compareCondition = (actual, expected) => {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) return actual === expected;
  return Object.entries(expected).every(([operator, value]) => {
    switch (operator) {
      case '$gt': return actual > value;
      case '$gte': return actual >= value;
      case '$lt': return actual < value;
      case '$lte': return actual <= value;
      case '$ne': return actual !== value;
      case '$in': return Array.isArray(value) && value.includes(actual);
      default: throw new ApiError(400, 'unsupported_query', `Operador de consulta não suportado: ${operator}`);
    }
  });
};

const matchesQuery = (record, query = {}) =>
  query && typeof query === 'object' && !Array.isArray(query)
    && Object.entries(query).every(([field, expected]) => compareCondition(record[field], expected));

const validateEntity = (entity) => {
  if (!entityNames.includes(entity)) throw new ApiError(404, 'entity_not_found', 'Tipo de registro não encontrado.');
};

const getEntityRecords = (database, entity) => {
  const records = database.entities[entity] || [];
  if (!Array.isArray(records)) throw new Error(`Os registros de ${entity} no armazenamento compartilhado são inválidos.`);
  return records;
};

const requireAdministrator = (user) => {
  if (getUserRole(user) !== 'admin') {
    throw new ApiError(403, 'forbidden', 'Somente o administrador de TI pode gerenciar usuários.');
  }
};

const validateRole = (role) => {
  if (!userRoles.includes(role)) {
    throw new ApiError(400, 'invalid_role', 'Selecione um tipo de usuário válido.');
  }
};

const adminHandler = async (request, response, url, actor) => {
  requireAdministrator(actor);

  if (request.method === 'GET' && url.pathname === '/api/admin/users') {
    const database = await readDatabase();
    const users = database.users.map((user) => ({
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
    publishChange({ event: 'user.created', user: safeUser, actor });
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
    const { user: updatedUser, accessChanged } = await updateDatabase((database) => {
      const user = database.users.find((item) => item.id === userId);
      if (!user) throw new ApiError(404, 'user_not_found', 'Usuário não encontrado.');
      const nextRole = role ?? getUserRole(user);
      const nextActive = active ?? user.active !== false;
      const nextCompanyIds = nextRole === 'admin'
        ? getUserCompanyIds(actor)
        : companyIds === undefined ? getUserCompanyIds(user) : [...companyIds];
      const removingAdmin = getUserRole(user) === 'admin' && (nextRole !== 'admin' || !nextActive);
      if (removingAdmin && database.users.filter((item) => getUserRole(item) === 'admin' && item.active !== false).length <= 1) {
        throw new ApiError(409, 'last_admin', 'Mantenha ao menos um administrador ativo.');
      }
      if (user.id === actor.id && (nextRole !== 'admin' || !nextActive
        || nextCompanyIds.length !== getUserCompanyIds(user).length
        || nextCompanyIds.some((id) => !getUserCompanyIds(user).includes(id)))) {
        throw new ApiError(409, 'cannot_change_self', 'Não é possível remover seu próprio acesso de administrador.');
      }
      const currentCompanyIds = getUserCompanyIds(user);
      const accessChanged = nextRole !== getUserRole(user) || nextActive !== (user.active !== false)
        || nextCompanyIds.length !== currentCompanyIds.length
        || nextCompanyIds.some((id) => !currentCompanyIds.includes(id));
      if (role !== undefined) user.role = role;
      if (active !== undefined) user.active = active;
      user.companyIds = nextCompanyIds;
      return {
        user: { ...publicUser(user), role: getUserRole(user), active: user.active !== false },
        accessChanged,
      };
    });
    if (accessChanged) revokeUserSessions(userId);
    publishChange({ event: 'user.updated', user: updatedUser, actor });
    sendJson(response, 200, { user: updatedUser });
    return;
  }

  throw new ApiError(404, 'not_found', 'Rota de gerenciamento de usuários não encontrada.');
};

const sortRecords = (records, sort, numeric = false) => {
  if (!sort) return records;
  const descending = sort.startsWith('-');
  const field = descending ? sort.slice(1) : sort;
  return [...records].sort((left, right) => {
    const a = left[field];
    const b = right[field];
    const comparison = numeric
      ? Number(a) - Number(b)
      : a == null ? (b == null ? 0 : -1) : b == null ? 1 : String(a).localeCompare(String(b), undefined, { numeric: true });
    return descending ? -comparison : comparison;
  });
};

const aggregateRecords = (records, { query = {}, groupBy, sum = [], avg = [], min = [], max = [], sort, limit } = {}) => {
  if (![sum, avg, min, max].every(Array.isArray)) {
    throw new ApiError(400, 'invalid_aggregate', 'Os campos de agregação devem ser listas.');
  }
  const filtered = records.filter((record) => matchesQuery(record, query));
  const groups = new Map();
  for (const record of filtered) {
    const key = groupBy ? record[groupBy] ?? null : null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }

  let rows = [...groups.entries()].map(([key, group]) => {
    const row = groupBy ? { [groupBy]: key } : {};
    row.count = group.length;
    for (const field of sum) {
      row[`sum_${field}`] = group.reduce((total, item) => total + (Number(item[field]) || 0), 0);
    }
    for (const field of avg) {
      const values = group.map((item) => Number(item[field])).filter(Number.isFinite);
      row[`avg_${field}`] = values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
    }
    for (const field of min) {
      const values = group.map((item) => Number(item[field])).filter(Number.isFinite);
      row[`min_${field}`] = values.length ? Math.min(...values) : null;
    }
    for (const field of max) {
      const values = group.map((item) => Number(item[field])).filter(Number.isFinite);
      row[`max_${field}`] = values.length ? Math.max(...values) : null;
    }
    return row;
  });
  rows = sortRecords(rows, sort, true);
  if (Number.isFinite(limit)) rows = rows.slice(0, Math.max(0, limit));
  return { rows };
};

const entityHandler = async (request, response, url) => {
  if (request.method === 'POST' && url.pathname === '/api/entities/migrate') {
    if (!isHostConnection(request)) {
      throw new ApiError(403, 'host_only', 'A importação dos dados antigos deve ser feita no computador que hospeda o app.');
    }
    const actor = await getSessionUser(request);
    if (!actor) {
      throw new ApiError(401, 'unauthorized', 'Entre como administrador para importar dados antigos.');
    }
    requireAdministrator(actor);
    const { entities } = await readJsonBody(request, 25 * 1024 * 1024);
    if (!entities || typeof entities !== 'object' || Array.isArray(entities)
      || Object.keys(entities).some((name) => !entityNames.includes(name))
      || Object.values(entities).some((records) => !Array.isArray(records))) {
      throw new ApiError(400, 'invalid_entities', 'Os dados locais não têm um formato válido para importação.');
    }

    const migrated = await updateDatabase((database) => {
      if (database.entitiesMigrated) return false;
      for (const name of entityNames) {
        const currentRecords = getEntityRecords(database, name);
        const importedRecords = entities[name] || [];
        const recordsById = new Map(currentRecords.map((record) => [record.id, record]));
        for (const record of importedRecords) {
          if (!record || typeof record !== 'object' || Array.isArray(record) || typeof record.id !== 'string') {
            throw new ApiError(400, 'invalid_entities', `Os dados locais de ${name} contêm um registro inválido.`);
          }
          const importedCompanyId = record.company_id === undefined
            ? actor.activeCompanyId
            : String(record.company_id);
          if (!actor.companyIds.includes(importedCompanyId)) {
            throw new ApiError(403, 'forbidden', 'A importação contém registros de uma empresa sem acesso autorizado.');
          }
          const existingRecord = recordsById.get(record.id);
          if (existingRecord && getRecordCompanyId(existingRecord) !== importedCompanyId) {
            throw new ApiError(409, 'record_id_conflict', 'Um registro importado já existe em outra empresa.');
          }
          if (!existingRecord) {
            recordsById.set(record.id, { ...record, company_id: importedCompanyId });
          }
        }
        database.entities[name] = [...recordsById.values()];
      }
      database.entitiesMigrated = true;
      return true;
    });
    if (migrated) {
      publishChange({
        event: 'entities.imported',
        actor,
        counts: Object.fromEntries(entityNames.map((name) => [name, (entities[name] || []).length])),
      });
    }
    sendJson(response, 200, { migrated });
    return;
  }

  const segments = url.pathname.split('/').filter(Boolean);
  const [, , entity, action, id] = segments;
  validateEntity(entity);

  const actor = await getSessionUser(request);
  if (!actor) {
    throw new ApiError(401, 'unauthorized', 'Entre na sua conta para acessar os dados compartilhados.');
  }
  const actorRole = getUserRole(actor);
  const isCollaborator = actorRole === 'collaborator';
  const isRouparia = actorRole === 'rouparia';

  if (request.method === 'POST' && action === 'filter') {
    const { query = {}, options = {} } = await readJsonBody(request);
    if (isCollaborator) {
      const allowedQueries = {
        Bed: query.status === 'aguardando_limpeza' && Object.keys(query).length === 1,
        CleaningTask: query.status === 'em_andamento'
          && (Object.keys(query).length === 1
            || (query.workflow_stage === 'rouparia' && Object.keys(query).length === 2)),
        Employee: query.active === true
          && ['higienizacao', 'rouparia'].includes(query.function)
          && Object.keys(query).length === 2,
        Material: query.active === true && Object.keys(query).length === 1,
      };
      if (!allowedQueries[entity]) {
        throw new ApiError(403, 'forbidden', 'O perfil colaborador só pode consultar a fila de limpeza e os dados necessários para executá-la.');
      }
    }
    if (isRouparia && !(
      (entity === 'CleaningTask' && query.status === 'em_andamento'
        && query.workflow_stage === 'rouparia' && Object.keys(query).length === 2)
      || (entity === 'Employee' && query.active === true && query.function === 'rouparia'
        && Object.keys(query).length === 2)
    )) {
      throw new ApiError(403, 'forbidden', 'O perfil rouparia só pode consultar leitos aguardando essa etapa.');
    }
    const database = await readDatabase();
    let records = getTenantRecords(database, entity, actor).filter((record) =>
      entity === 'Employee' && query.function === 'higienizacao'
        ? record.active === true && (!record.function || record.function === 'higienizacao')
        : matchesQuery(record, query));
    if (isCollaborator && entity === 'CleaningTask') {
      const stage = query.workflow_stage || 'higienizacao';
      records = getTenantRecords(database, entity, actor).filter((task) =>
        task.status === 'em_andamento'
        && (task.workflow_stage || 'higienizacao') === stage);
    }
    records = sortRecords(records, options.sort);
    if (Number.isFinite(options.limit)) records = records.slice(0, Math.max(0, options.limit));
    sendJson(response, 200, { items: records });
    return;
  }

  if (request.method === 'POST' && action === 'aggregate') {
    if (isCollaborator || isRouparia) {
      throw new ApiError(403, 'forbidden', `O perfil ${isRouparia ? 'rouparia' : 'colaborador'} não pode consultar relatórios ou indicadores.`);
    }
    const database = await readDatabase();
    sendJson(response, 200, aggregateRecords(getTenantRecords(database, entity, actor), await readJsonBody(request)));
    return;
  }

  if (request.method === 'POST' && action === 'create') {
    const values = await readJsonBody(request);
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      throw new ApiError(400, 'invalid_record', 'Os dados do registro são inválidos.');
    }
    const recordCompanyId = entity === 'Employee' && values.company_id !== undefined
      ? String(values.company_id)
      : actor.activeCompanyId;
    if (!actor.companyIds.includes(recordCompanyId)) {
      throw new ApiError(403, 'forbidden', 'Sua conta não tem acesso à empresa selecionada.');
    }
    if (entity !== 'Employee') assertActiveCompany(values.company_id, actor);
    if (entity === 'Bed' || entity === 'Unit') {
      throw new ApiError(403, 'oracle_managed_structure', 'Leitos e postos são importados do MV e não podem ser cadastrados manualmente.');
    }
    if (isRouparia) {
      throw new ApiError(403, 'forbidden', 'O perfil rouparia não pode criar registros.');
    }
    if (isCollaborator && !(entity === 'CleaningTask' && values.status === 'em_andamento')) {
      throw new ApiError(403, 'forbidden', 'O perfil colaborador só pode registrar operações do processo de limpeza.');
    }
    if (isCollaborator && entity === 'CleaningTask' && Object.keys(values).some((field) =>
      !['bed_id', 'bed_code', 'unit_name', 'employee_id', 'employee_name', 'cleaning_type', 'status', 'started_at', 'mv_sync_status', 'workflow_stage', 'higienizacao_started_at'].includes(field))) {
      throw new ApiError(403, 'forbidden', 'A tarefa contém campos que o perfil colaborador não pode definir.');
    }
    if (entity === 'MaterialCheck' && !['admin', 'manager'].includes(actorRole)) {
      throw new ApiError(403, 'forbidden', 'Somente a liderança de hotelaria pode registrar a conferência de utensílios.');
    }
    if (entity === 'Employee') {
      const registration = typeof values.registration === 'string' ? values.registration.trim() : '';
      if (typeof values.name !== 'string' || !values.name.trim()
        || !registration || !['higienizacao', 'rouparia'].includes(values.function)) {
        throw new ApiError(400, 'invalid_employee', 'Informe nome, matrícula e uma função válida para o colaborador.');
      }
      values.name = values.name.trim();
      values.registration = registration;
    }
    const now = new Date().toISOString();
    const defaults = entity === 'Bed' ? { status: 'livre', missing_count: 0 }
      : entity === 'Employee' || entity === 'Material' ? { active: true }
        : {};
    const record = {
      ...defaults,
      ...values,
      company_id: recordCompanyId,
      id: randomUUID(),
      created_date: now,
      updated_date: now,
    };
    await updateDatabase((database) => {
      if (entity === 'Employee' && getCompanyRecords(database, 'Employee', recordCompanyId).some((item) =>
        typeof item.registration === 'string' && item.registration.trim() === values.registration)) {
        throw new ApiError(409, 'duplicate_registration', 'Já existe um colaborador cadastrado com esta matrícula.');
      }
      if (entity === 'CleaningTask' && values.status === 'em_andamento') {
        const bed = getTenantRecords(database, 'Bed', actor).find((item) => item.id === values.bed_id);
        const employee = getTenantRecords(database, 'Employee', actor).find((item) =>
          item.id === values.employee_id && item.active === true
          && (!item.function || item.function === 'higienizacao'));
        if (!employee) {
          throw new ApiError(400, 'employee_not_found', 'Informe a matrícula de um colaborador ativo de higienização e limpeza.');
        }
        Object.assign(record, {
          employee_id: employee.id,
          employee_name: employee.name,
        });
        if (bed) {
          const requestedAt = Number.isFinite(Date.parse(bed.updated_date)) ? bed.updated_date : now;
          record.workflow_stage = 'higienizacao';
          record.requested_at = requestedAt;
          record.started_at = now;
          record.higienizacao_started_at = now;
          record.higienizacao_idle_seconds = Number.isFinite(Date.parse(bed.updated_date))
            ? Math.max(0, Math.round((Date.parse(now) - Date.parse(bed.updated_date)) / 1000))
            : 0;
          if (bed.oracle_source === 'oracle') {
            record.oracle_source = 'oracle';
            record.oracle_company_code = bed.oracle_company_code;
            record.oracle_cd_leito = bed.oracle_cd_leito;
            record.oracle_request_id = bed.oracle_request_id;
            record.oracle_request_type = bed.oracle_request_type;
          }
        }
        const employeeHasActiveTask = getTenantRecords(database, 'CleaningTask', actor).some((task) =>
          task.employee_id === values.employee_id && task.status === 'em_andamento'
          && (!task.workflow_stage || task.workflow_stage === 'higienizacao'));
        if (employeeHasActiveTask) {
          throw new ApiError(409, 'employee_has_active_task', 'Este colaborador já está realizando uma limpeza.');
        }
      }
      if (isCollaborator) {
        if (entity === 'CleaningTask') {
          const bed = getTenantRecords(database, 'Bed', actor).find((item) => item.id === values.bed_id);
          const employee = getTenantRecords(database, 'Employee', actor).find((item) =>
            item.id === values.employee_id && item.active === true);
          const activeTask = getTenantRecords(database, 'CleaningTask', actor).some((item) =>
            item.bed_id === values.bed_id && item.status === 'em_andamento');
          if (!bed || bed.status !== 'aguardando_limpeza' || activeTask) {
            throw new ApiError(409, 'bed_not_ready', 'Este leito não está disponível para iniciar uma limpeza.');
          }
          if (!employee || (employee.function && employee.function !== 'higienizacao')) {
            throw new ApiError(400, 'employee_not_found', 'Informe a matrícula de um colaborador ativo de higienização e limpeza.');
          }
          if (!['terminal', 'concorrente'].includes(values.cleaning_type)) {
            throw new ApiError(400, 'invalid_cleaning_type', 'Selecione um tipo de limpeza válido.');
          }
          Object.assign(record, {
            bed_id: bed.id,
            bed_code: bed.code,
            unit_name: bed.unit_name,
            employee_id: employee.id,
            employee_name: employee.name,
            requested_at: Number.isFinite(Date.parse(bed.updated_date)) ? bed.updated_date : now,
            started_at: now,
            status: 'em_andamento',
            mv_sync_status: 'pendente',
            workflow_stage: 'higienizacao',
            higienizacao_started_at: now,
            higienizacao_idle_seconds: Number.isFinite(Date.parse(bed.updated_date))
              ? Math.max(0, Math.round((Date.now() - Date.parse(bed.updated_date)) / 1000))
              : 0,
          });
        }
      }
      if (entity === 'MaterialCheck') {
        const allowedFields = [
          'bed_id', 'bed_code', 'unit_name', 'task_id', 'checked_by', 'status',
          'total_items', 'missing_count', 'missing_items',
        ];
        const task = getTenantRecords(database, 'CleaningTask', actor).find((item) =>
          item.id === values.task_id && item.status === 'em_andamento'
          && item.workflow_stage === 'revisao' && item.revisao_started_at);
        const materialCount = getTenantRecords(database, 'Material', actor).filter((item) => item.active === true).length;
        if (Object.keys(values).some((field) => !allowedFields.includes(field))) {
          throw new ApiError(400, 'invalid_material_check', 'A conferência contém campos inválidos.');
        }
        if (!task || task.bed_id !== values.bed_id
          || values.bed_code !== task.bed_code || values.unit_name !== task.unit_name) {
          throw new ApiError(409, 'task_not_in_review', 'A conferência só pode ser feita durante a revisão ativa do leito.');
        }
        if (!Number.isInteger(values.total_items) || values.total_items !== materialCount
          || !Number.isInteger(values.missing_count) || values.missing_count < 0
          || values.missing_count > values.total_items
          || typeof values.missing_items !== 'string'
          || (values.missing_count === 0 && values.missing_items !== '')
          || (values.missing_count > 0 && !values.missing_items.trim())
          || values.status !== (values.missing_count ? 'com_falta' : 'ok')) {
          throw new ApiError(400, 'invalid_material_check', 'Os dados da conferência de materiais são inválidos.');
        }
        Object.assign(record, {
          bed_id: task.bed_id,
          bed_code: task.bed_code,
          unit_name: task.unit_name,
          task_id: task.id,
          checked_by: actor.name || actor.email,
          status: values.status,
          total_items: values.total_items,
          missing_count: values.missing_count,
          missing_items: values.missing_items,
          checked_at: now,
        });
      }
      database.entities[entity] = [...getEntityRecords(database, entity), record];
    });
    publishChange({ event: 'entity.created', entity, record, actor });
    sendJson(response, 201, { record });
    return;
  }

  if (request.method === 'PATCH' && action === 'record' && id) {
    let values = await readJsonBody(request);
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      throw new ApiError(400, 'invalid_record', 'Os dados do registro são inválidos.');
    }
    assertActiveCompany(values.company_id, actor);
    if (entity === 'Unit' && actorRole !== 'admin') {
      throw new ApiError(403, 'forbidden', 'Somente o administrador de TI pode gerenciar unidades.');
    }
    const isStageStartAction = entity === 'CleaningTask' && values.workflow_action === 'start';
    if (isStageStartAction) {
      const permitted = values.workflow_stage === 'rouparia'
        ? ['admin', 'manager', 'collaborator', 'rouparia'].includes(actorRole)
        : values.workflow_stage === 'revisao' && ['admin', 'manager'].includes(actorRole);
      const allowedFields = values.workflow_stage === 'rouparia'
        ? ['workflow_action', 'workflow_stage', 'rouparia_employee_id']
        : ['workflow_action', 'workflow_stage'];
      if (!permitted || Object.keys(values).some((field) => !allowedFields.includes(field))) {
        throw new ApiError(403, 'forbidden', 'Este perfil não pode iniciar a etapa solicitada.');
      }
    }
    if (isCollaborator && entity === 'CleaningTask') {
      const allowedFields = isStageStartAction
        ? ['workflow_action', 'workflow_stage', 'rouparia_employee_id']
        : values.workflow_stage === 'revisao'
          ? ['workflow_stage', 'rouparia_finished_at', 'rouparia_duration_seconds', 'revisao_idle_started_at', 'rouparia_by']
          : values.workflow_stage === 'rouparia'
            ? ['workflow_stage', 'higienizacao_finished_at', 'higienizacao_duration_seconds', 'rouparia_idle_started_at']
            : values.workflow_stage === 'manutencao'
              ? ['workflow_stage', 'maintenance_return_stage', 'maintenance_reason', 'maintenance_requested_by', 'maintenance_started_at', 'maintenance_return_active', 'maintenance_total_seconds', 'higienizacao_duration_seconds', 'higienizacao_started_at', 'higienizacao_idle_seconds', 'higienizacao_idle_started_at', 'rouparia_duration_seconds', 'rouparia_started_at', 'rouparia_idle_seconds', 'rouparia_idle_started_at']
          : [];
      if (!allowedFields.length || Object.keys(values).some((field) => !allowedFields.includes(field))) {
        throw new ApiError(403, 'forbidden', 'O perfil colaborador só pode concluir a higienização ou acionar manutenção.');
      }
    } else     if (isCollaborator && entity === 'Bed') {
      const isTaskStatusUpdate = Object.keys(values).length === 1 && Object.hasOwn(values, 'status')
        && ['em_limpeza', 'aguardando_rouparia', 'em_rouparia', 'aguardando_revisao', 'aguardando_manutencao'].includes(values.status);
      if (!isTaskStatusUpdate) {
        throw new ApiError(403, 'forbidden', 'O perfil colaborador só pode atualizar dados vinculados ao processo de limpeza.');
      }
    } else if (isRouparia && entity === 'CleaningTask') {
      const allowedFields = isStageStartAction
        ? ['workflow_action', 'workflow_stage', 'rouparia_employee_id']
        : values.workflow_stage === 'revisao'
        ? ['workflow_stage', 'rouparia_finished_at', 'rouparia_duration_seconds', 'revisao_idle_started_at', 'rouparia_by']
        : values.workflow_stage === 'manutencao'
          ? ['workflow_stage', 'maintenance_return_stage', 'maintenance_reason', 'maintenance_requested_by', 'maintenance_started_at', 'maintenance_return_active', 'maintenance_total_seconds', 'rouparia_duration_seconds', 'rouparia_started_at', 'rouparia_idle_seconds', 'rouparia_idle_started_at']
          : [];
      if (!allowedFields.length || Object.keys(values).some((field) => !allowedFields.includes(field))) {
        throw new ApiError(403, 'forbidden', 'O perfil rouparia só pode concluir a rouparia ou acionar manutenção.');
      }
    } else if (isRouparia && entity === 'Bed') {
      if (Object.keys(values).length !== 1 || !['em_rouparia', 'aguardando_revisao', 'aguardando_manutencao'].includes(values.status)) {
        throw new ApiError(403, 'forbidden', 'O perfil rouparia só pode encaminhar leitos para revisão ou manutenção.');
      }
    } else if (isCollaborator) {
      throw new ApiError(403, 'forbidden', 'O perfil colaborador não pode alterar este tipo de registro.');
    } else if (isRouparia) {
      throw new ApiError(403, 'forbidden', 'O perfil rouparia não pode alterar este tipo de registro.');
    }
    const { record: updated, previousRecord } = await updateDatabase((database) => {
      const records = getEntityRecords(database, entity);
      const index = records.findIndex((record) =>
        record.id === id && getRecordCompanyId(record) === actor.activeCompanyId);
      if (index === -1) throw new ApiError(404, 'record_not_found', `${entity} não encontrado.`);
      const previousRecord = records[index];
      if (isStageStartAction) {
        const stage = values.workflow_stage;
        const startedField = `${stage}_started_at`;
        const idleStartedField = `${stage}_idle_started_at`;
        const prerequisiteField = stage === 'rouparia' ? 'higienizacao_finished_at' : 'rouparia_finished_at';
        const now = new Date();
        const nowIso = now.toISOString();
        const idleStart = Date.parse(previousRecord[idleStartedField] || previousRecord[prerequisiteField]);
        if (previousRecord.status !== 'em_andamento'
          || previousRecord.workflow_stage !== stage
          || previousRecord[startedField]
          || !Number.isFinite(idleStart)) {
          throw new ApiError(409, 'stage_not_waiting', 'A etapa não está aguardando início ou já foi iniciada.');
        }
        let stageAssignment = {};
        if (stage === 'rouparia') {
          const employee = getTenantRecords(database, 'Employee', actor).find((item) =>
            item.id === values.rouparia_employee_id && item.active === true && item.function === 'rouparia');
          if (!employee) {
            throw new ApiError(400, 'employee_not_found', 'Informe a matrícula de um colaborador ativo de rouparia.');
          }
          const employeeHasActiveStage = getTenantRecords(database, 'CleaningTask', actor).some((task) =>
            task.id !== id && task.status === 'em_andamento'
            && task.workflow_stage === 'rouparia'
            && task.rouparia_employee_id === employee.id);
          if (employeeHasActiveStage) {
            throw new ApiError(409, 'employee_has_active_task', 'Este colaborador já está realizando uma tarefa de rouparia.');
          }
          stageAssignment = {
            rouparia_employee_id: employee.id,
            rouparia_employee_name: employee.name,
          };
        }
        values = {
          [`${stage}_started_at`]: nowIso,
          [`${stage}_idle_seconds`]: (Number(previousRecord[`${stage}_idle_seconds`]) || 0)
            + Math.max(0, Math.round((now.getTime() - idleStart) / 1000)),
          [idleStartedField]: null,
          ...stageAssignment,
        };
      }
      if (entity === 'CleaningTask' && values.status === 'concluida'
        && previousRecord.status === 'em_andamento' && previousRecord.workflow_stage === 'revisao') {
        throw new ApiError(409, 'review_endpoint_required', 'Conclua a revisão pela ação oficial de liberação do leito.');
      }
      if (entity === 'Bed' && values.status === 'livre' && previousRecord.oracle_source === 'oracle') {
        const hasReleasedTask = getTenantRecords(database, 'CleaningTask', actor).some((task) =>
          task.bed_id === id && task.status === 'concluida' && task.mv_sync_status === 'sincronizado');
        if (!hasReleasedTask) {
          throw new ApiError(409, 'oracle_release_required', 'Conclua a revisão para liberar este leito no MV.');
        }
      }
      if ((isCollaborator || isRouparia) && entity === 'CleaningTask'
        && previousRecord.status !== 'em_andamento') {
        throw new ApiError(409, 'task_not_active', 'Este processo não está mais em andamento.');
      }
      if (isCollaborator && entity === 'CleaningTask' && !isStageStartAction) {
        const currentStage = previousRecord.workflow_stage || 'higienizacao';
        const now = new Date();
        const timestamp = now.toISOString();
        if (values.workflow_stage === 'rouparia' && currentStage === 'higienizacao') {
          const startedAt = Date.parse(previousRecord.higienizacao_started_at || previousRecord.started_at);
          if (!Number.isFinite(startedAt)) {
            throw new ApiError(409, 'invalid_task_start', 'A tarefa não tem um horário inicial válido.');
          }
          const durationEnd = now.getTime();
          values = {
            workflow_stage: 'rouparia',
            higienizacao_finished_at: timestamp,
            higienizacao_duration_seconds: (Number(previousRecord.higienizacao_duration_seconds) || 0)
              + Math.max(0, Math.round((durationEnd - startedAt) / 1000)),
            rouparia_idle_started_at: timestamp,
          };
        } else if (values.workflow_stage === 'revisao' && currentStage === 'rouparia'
          && previousRecord.rouparia_started_at) {
          const startedAt = Date.parse(previousRecord.rouparia_started_at);
          if (!Number.isFinite(startedAt)) {
            throw new ApiError(409, 'invalid_stage_start', 'A etapa de rouparia não tem um horário inicial válido.');
          }
          values = {
            workflow_stage: 'revisao',
            rouparia_finished_at: timestamp,
            rouparia_duration_seconds: (Number(previousRecord.rouparia_duration_seconds) || 0)
              + Math.max(0, Math.round((now.getTime() - startedAt) / 1000)),
            revisao_idle_started_at: timestamp,
            rouparia_by: previousRecord.rouparia_employee_name || actor.email,
          };
        } else if (values.workflow_stage === 'manutencao'
          && ['higienizacao', 'rouparia'].includes(currentStage)
          && values.maintenance_return_stage === currentStage && values.maintenance_reason?.trim()) {
          const isHygiene = currentStage === 'higienizacao';
          const startedAt = Date.parse(previousRecord[`${currentStage}_started_at`] || (isHygiene ? previousRecord.started_at : null));
          const idleStart = Date.parse(previousRecord[`${currentStage}_idle_started_at`]
            || (isHygiene ? previousRecord.requested_at : previousRecord.higienizacao_finished_at));
          const hasStarted = Number.isFinite(startedAt);
          const currentDuration = Number(previousRecord[`${currentStage}_duration_seconds`]) || 0;
          const duration = hasStarted && Number.isFinite(startedAt)
            ? currentDuration + Math.max(0, Math.round((now.getTime() - startedAt) / 1000))
            : currentDuration;
          const idleDuration = !hasStarted && Number.isFinite(idleStart)
            ? (Number(previousRecord[`${currentStage}_idle_seconds`]) || 0)
              + Math.max(0, Math.round((now.getTime() - idleStart) / 1000))
            : Number(previousRecord[`${currentStage}_idle_seconds`]) || 0;
          values = {
            workflow_stage: 'manutencao',
            maintenance_return_stage: currentStage,
            maintenance_reason: values.maintenance_reason.trim(),
            maintenance_requested_by: actor.email,
            maintenance_started_at: timestamp,
            maintenance_return_active: hasStarted,
            maintenance_total_seconds: Number(previousRecord.maintenance_total_seconds) || 0,
            [`${currentStage}_duration_seconds`]: duration,
            [`${currentStage}_started_at`]: null,
            [`${currentStage}_idle_started_at`]: null,
            [`${currentStage}_idle_seconds`]: idleDuration,
          };
        } else {
          throw new ApiError(409, 'invalid_workflow_transition', 'Esta etapa já foi concluída ou não pode ser alterada.');
        }
      }
      if (isRouparia && entity === 'CleaningTask' && !isStageStartAction) {
        const now = new Date();
        const timestamp = now.toISOString();
        if (values.workflow_stage === 'revisao' && previousRecord.workflow_stage === 'rouparia'
          && previousRecord.rouparia_started_at) {
          const startedAt = Date.parse(previousRecord.rouparia_started_at);
          if (!Number.isFinite(startedAt)) {
            throw new ApiError(409, 'invalid_stage_start', 'A etapa de rouparia não tem um horário inicial válido.');
          }
          const durationEnd = now.getTime();
          values = {
            workflow_stage: 'revisao',
            rouparia_finished_at: timestamp,
            rouparia_duration_seconds: (Number(previousRecord.rouparia_duration_seconds) || 0)
              + Math.max(0, Math.round((durationEnd - startedAt) / 1000)),
            revisao_idle_started_at: timestamp,
            rouparia_by: previousRecord.rouparia_employee_name || actor.email,
          };
        } else if (values.workflow_stage === 'manutencao' && previousRecord.workflow_stage === 'rouparia'
          && values.maintenance_return_stage === 'rouparia' && values.maintenance_reason?.trim()) {
          const startedAt = Date.parse(previousRecord.rouparia_started_at);
          const taskStartedAt = Date.parse(previousRecord.started_at);
          if (!Number.isFinite(taskStartedAt)) {
            throw new ApiError(409, 'invalid_stage_start', 'O processo não tem horários iniciais válidos.');
          }
          const hasStarted = Number.isFinite(startedAt);
          const idleStart = Date.parse(previousRecord.rouparia_idle_started_at || previousRecord.higienizacao_finished_at);
          const duration = hasStarted
            ? (Number(previousRecord.rouparia_duration_seconds) || 0)
              + Math.max(0, Math.round((now.getTime() - startedAt) / 1000))
            : Number(previousRecord.rouparia_duration_seconds) || 0;
          const idleDuration = !hasStarted && Number.isFinite(idleStart)
            ? (Number(previousRecord.rouparia_idle_seconds) || 0)
              + Math.max(0, Math.round((now.getTime() - idleStart) / 1000))
            : Number(previousRecord.rouparia_idle_seconds) || 0;
          values = {
            workflow_stage: 'manutencao',
            maintenance_return_stage: 'rouparia',
            maintenance_reason: values.maintenance_reason.trim(),
            maintenance_requested_by: actor.email,
            maintenance_started_at: timestamp,
            maintenance_return_active: hasStarted,
            maintenance_total_seconds: Number(previousRecord.maintenance_total_seconds) || 0,
            rouparia_duration_seconds: duration,
            rouparia_started_at: null,
            rouparia_idle_started_at: null,
            rouparia_idle_seconds: idleDuration,
          };
        } else {
          throw new ApiError(409, 'invalid_workflow_transition', 'O leito já saiu da etapa de rouparia.');
        }
      }
      if (isCollaborator && entity === 'Bed') {
        if (Object.hasOwn(values, 'status')) {
          const activeTask = getTenantRecords(database, 'CleaningTask', actor).find((task) =>
            task.bed_id === id && task.status === 'em_andamento');
          const isStartingHygiene = values.status === 'em_limpeza'
            && previousRecord.status === 'aguardando_limpeza'
            && activeTask && (!activeTask.workflow_stage || activeTask.workflow_stage === 'higienizacao');
          const isSendingToLinen = values.status === 'em_rouparia'
            && previousRecord.status === 'em_limpeza'
            && activeTask?.workflow_stage === 'rouparia';
          const isWaitingForLinen = values.status === 'aguardando_rouparia'
            && previousRecord.status === 'em_limpeza'
            && activeTask?.workflow_stage === 'rouparia';
          const isStartingLinen = values.status === 'em_rouparia'
            && previousRecord.status === 'aguardando_rouparia'
            && activeTask?.workflow_stage === 'rouparia' && activeTask.rouparia_started_at;
          const isSendingToReview = values.status === 'aguardando_revisao'
            && previousRecord.status === 'em_rouparia'
            && activeTask?.workflow_stage === 'revisao';
          const isCallingMaintenance = values.status === 'aguardando_manutencao'
            && ['em_limpeza', 'aguardando_rouparia', 'em_rouparia'].includes(previousRecord.status)
            && activeTask?.workflow_stage === 'manutencao'
            && activeTask.maintenance_return_stage === (['em_limpeza'].includes(previousRecord.status) ? 'higienizacao' : 'rouparia');
          if (!isStartingHygiene && !isSendingToLinen && !isWaitingForLinen && !isStartingLinen && !isSendingToReview && !isCallingMaintenance) {
            throw new ApiError(409, 'active_task_required', 'Inicie uma tarefa de limpeza antes de alterar o status do leito.');
          }
        }
        if (Object.hasOwn(values, 'missing_count')) {
          const hasMatchingCheck = getTenantRecords(database, 'MaterialCheck', actor).some((check) =>
            check.bed_id === id
              && check.status === (values.missing_count ? 'com_falta' : 'ok')
              && check.missing_count === values.missing_count
              && check.missing_items === values.missing_items
              && getTenantRecords(database, 'CleaningTask', actor).some((task) =>
                task.id === check.task_id && task.status === 'em_andamento'));
          if (!hasMatchingCheck) {
            throw new ApiError(409, 'material_check_required', 'Registre uma conferência válida antes de atualizar os materiais do leito.');
          }
        }
      }
      if (isRouparia && entity === 'Bed') {
        const activeTask = getTenantRecords(database, 'CleaningTask', actor).find((task) =>
          task.bed_id === id && task.status === 'em_andamento');
        const isStartingLinen = values.status === 'em_rouparia'
          && previousRecord.status === 'aguardando_rouparia'
          && activeTask?.workflow_stage === 'rouparia' && activeTask.rouparia_started_at;
        const isSendingToReview = values.status === 'aguardando_revisao'
          && previousRecord.status === 'em_rouparia'
          && activeTask?.workflow_stage === 'revisao';
        const isCallingMaintenance = values.status === 'aguardando_manutencao'
          && ['aguardando_rouparia', 'em_rouparia'].includes(previousRecord.status)
          && activeTask?.workflow_stage === 'manutencao'
          && activeTask.maintenance_return_stage === 'rouparia';
        if (!isStartingLinen && !isSendingToReview && !isCallingMaintenance) {
          throw new ApiError(409, 'invalid_bed_transition', 'Este leito não pode ser encaminhado a partir da etapa atual.');
        }
      }
      if (isCollaborator && entity === 'Bed' && values.status === 'aguardando_manutencao') {
        const activeTask = getTenantRecords(database, 'CleaningTask', actor).find((task) =>
          task.bed_id === id && task.status === 'em_andamento');
        const isCallingMaintenance = activeTask?.workflow_stage === 'manutencao'
          && ['higienizacao', 'rouparia'].includes(activeTask.maintenance_return_stage)
          && (activeTask.maintenance_return_stage === 'higienizacao'
            ? previousRecord.status === 'em_limpeza'
            : ['aguardando_rouparia', 'em_rouparia'].includes(previousRecord.status));
        if (!isCallingMaintenance) {
          throw new ApiError(409, 'invalid_bed_transition', 'Este leito não pode ser encaminhado à manutenção a partir da etapa atual.');
        }
      }
      const record = { ...previousRecord, ...values, id, updated_date: new Date().toISOString() };
      database.entities[entity] = records.map((item, itemIndex) => itemIndex === index ? record : item);
      return { record, previousRecord };
    });
    const changedFields = Object.keys(values).filter((field) => values[field] !== previousRecord[field]);
    publishChange({
      event: entity === 'Bed' && updated.status !== previousRecord.status ? 'bed.status_changed' : 'entity.updated',
      entity,
      record: updated,
      previousRecord,
      changedFields,
      actor,
    });
    sendJson(response, 200, { record: updated });
    return;
  }

  if (request.method === 'DELETE' && action === 'record' && id) {
    if (isCollaborator || isRouparia) {
      throw new ApiError(403, 'forbidden', `O perfil ${isRouparia ? 'rouparia' : 'colaborador'} não pode excluir registros.`);
    }
    if (entity === 'Bed' && !['admin', 'manager'].includes(actorRole)) {
      throw new ApiError(403, 'forbidden', 'Somente administradores e gestores podem excluir leitos manuais.');
    }
    if (entity === 'Unit' && actorRole !== 'admin') {
      throw new ApiError(403, 'forbidden', 'Somente o administrador de TI pode gerenciar unidades.');
    }
    const record = await updateDatabase((database) => {
      const records = getEntityRecords(database, entity);
      const deletedRecord = records.find((record) =>
        record.id === id && getRecordCompanyId(record) === actor.activeCompanyId);
      if (!deletedRecord) {
        throw new ApiError(404, 'record_not_found', `${entity} não encontrado.`);
      }
      if (entity === 'Bed') {
        if (deletedRecord.oracle_source === 'oracle') {
          throw new ApiError(403, 'oracle_bed_read_only', 'Leitos importados do Oracle não podem ser excluídos pelo cadastro manual.');
        }
        const hasCleaningHistory = getTenantRecords(database, 'CleaningTask', actor)
          .some((task) => task.bed_id === id);
        if (hasCleaningHistory) {
          throw new ApiError(409, 'bed_has_history', 'Este leito possui histórico de processos e não pode ser removido.');
        }
      }
      database.entities[entity] = records.filter((record) => record.id !== id);
      return deletedRecord;
    });
    publishChange({ event: 'entity.deleted', entity, record, actor });
    sendJson(response, 200, { success: true });
    return;
  }

  throw new ApiError(404, 'not_found', 'Rota de dados compartilhados não encontrada.');
};

const createSession = (userId, activeCompanyId = '1') => {
  const token = randomBytes(32).toString('base64url');
  sessions.set(token, { userId, activeCompanyId, expiresAt: Date.now() + sessionDurationMs });
  return token;
};

const closeEventStreams = (matchesSession) => {
  for (const [response, session] of eventClients) {
    if (!matchesSession(session)) continue;
    eventClients.delete(response);
    response.end();
  }
};

const revokeUserSessions = (userId) => {
  const revokedTokens = new Set();
  for (const [token, session] of sessions) {
    if (session.userId !== userId) continue;
    sessions.delete(token);
    revokedTokens.add(token);
  }
  for (const [response, session] of eventClients) {
    if (!revokedTokens.has(session.token)) continue;
    response.write(`event: change\ndata: ${JSON.stringify({ event: 'user.access_changed' })}\n\n`);
  }
  closeEventStreams((session) => revokedTokens.has(session.token));
};

const getSessionUser = async (request) => {
  const token = getSessionToken(request);
  const session = token ? sessions.get(token) : null;
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }

  const database = await readDatabase();
  const user = database.users.find((item) => item.id === session.userId);
  if (!user || user.active === false) {
    sessions.delete(token);
    return null;
  }
  const companyIds = getUserCompanyIds(user);
  if (!companyIds.includes(session.activeCompanyId)) {
    session.activeCompanyId = companyIds[0];
  }
  return getSessionUserData(user, session.activeCompanyId);
};

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

  await updateDatabase((database) => {
    if (database.users.some((item) => item.email === normalizedEmail)) {
      throw new ApiError(409, 'account_exists', 'Já existe uma conta com este e-mail.');
    }
    database.users.push(user);
  });
  return user;
};

const authHandler = async (request, response, url) => {
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
    const token = getSessionToken(request);
    const session = sessions.get(token);
    session.activeCompanyId = companyId;
    sendJson(response, 200, {
      user: getSessionUserData(actor, companyId),
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/bootstrap-admin') {
    if (!isHostConnection(request)) {
      throw new ApiError(403, 'host_only', 'O primeiro administrador deve ser configurado no computador host.');
    }
    if (!adminBootstrapEmail) {
      throw new ApiError(503, 'admin_not_configured', 'O TI precisa configurar HIGI_ADMIN_EMAIL no arquivo .env.local do computador host.');
    }
    const { email, password } = await readJsonBody(request);
    if (typeof password !== 'string' || password.length < 6) {
      throw new ApiError(400, 'weak_password', 'A senha deve ter pelo menos 6 caracteres.');
    }
    if (typeof email !== 'string' || email.trim().toLowerCase() !== adminBootstrapEmail) {
      throw new ApiError(403, 'bootstrap_email_mismatch', 'Use o e-mail de administrador configurado pelo TI.');
    }

    let user;
    await updateDatabase(async (database) => {
      if (database.users.some((item) => getUserRole(item) === 'admin')) {
        throw new ApiError(409, 'admin_already_configured', 'O administrador inicial já foi configurado.');
      }
      const existingUser = database.users.find((item) => item.email === adminBootstrapEmail);
      if (existingUser) {
        if (existingUser.active === false || !(await passwordsMatch(password, existingUser))) {
          throw new ApiError(401, 'invalid_credentials', 'E-mail ou senha inválidos.');
        }
        existingUser.role = 'admin';
        existingUser.companyIds = companies.map(({ id }) => id);
        user = existingUser;
        return;
      }

      user = {
        id: randomUUID(),
        email: adminBootstrapEmail,
        role: 'admin',
        companyIds: companies.map(({ id }) => id),
        active: true,
        ...await makePasswordCredentials(password),
      };
      database.users.push(user);
    });
    const token = createSession(user.id, '1');
    const safeUser = { ...getSessionUserData(user, '1'), active: true };
    publishChange({ event: 'user.admin_bootstrapped', user: safeUser, actor: safeUser });
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
    const normalizedEmail = email.trim().toLowerCase();
    const database = await readDatabase();
    const user = database.users.find((item) => item.email === normalizedEmail);
    if (!user) throw new ApiError(404, 'account_not_found', 'E-mail ou senha inválidos.');
    if (user.active === false) throw new ApiError(403, 'account_inactive', 'Esta conta foi desativada. Procure o administrador de TI.');
    if (!(await passwordsMatch(password, user))) {
      throw new ApiError(401, 'invalid_credentials', 'E-mail ou senha inválidos.');
    }

    const activeCompanyId = getUserCompanyIds(user)[0];
    const token = createSession(user.id, activeCompanyId);
    sendJson(response, 200, {
      user: { ...getSessionUserData(user, activeCompanyId), active: true },
    }, { 'Set-Cookie': setSessionCookie(token) });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
    const token = getSessionToken(request);
    if (token) {
      sessions.delete(token);
      closeEventStreams((session) => session.token === token);
    }
    sendJson(response, 200, { success: true }, { 'Set-Cookie': clearSessionCookie });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/reset-request') {
    if (!isHostConnection(request)) {
      throw new ApiError(403, 'host_only', 'Por segurança, gere o link de redefinição no computador que hospeda o app.');
    }
    const { email } = await readJsonBody(request);
    if (typeof email !== 'string') throw new ApiError(400, 'invalid_email', 'Informe um e-mail válido.');
    const normalizedEmail = email.trim().toLowerCase();
    const token = randomBytes(32).toString('hex');
    await updateDatabase((database) => {
      const user = database.users.find((item) => item.email === normalizedEmail);
      if (!user) throw new ApiError(404, 'account_not_found', 'Não existe uma conta com este e-mail.');
      database.resetTokens = database.resetTokens.filter((item) => item.userId !== user.id);
      database.resetTokens.push({ token, userId: user.id, expiresAt: Date.now() + 30 * 60 * 1000 });
    });
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
    let userId;
    let resetUser;
    await updateDatabase((database) => {
      const reset = database.resetTokens.find((item) => item.token === resetToken && item.expiresAt > Date.now());
      if (!reset) throw new ApiError(400, 'invalid_reset_token', 'O link de redefinição é inválido ou expirou.');
      const user = database.users.find((item) => item.id === reset.userId);
      if (!user) throw new ApiError(404, 'account_not_found', 'A conta não foi encontrada.');
      Object.assign(user, credentials);
      userId = user.id;
      resetUser = { ...publicUser(user), role: getUserRole(user) };
      database.resetTokens = database.resetTokens.filter((item) => item.token !== resetToken);
    });
    for (const [token, session] of sessions) {
      if (session.userId === userId) {
        sessions.delete(token);
        closeEventStreams((eventSession) => eventSession.token === token);
      }
    }
    publishChange({ event: 'user.password_reset', user: resetUser, actor: resetUser });
    sendJson(response, 200, { success: true });
    return;
  }

  throw new ApiError(404, 'not_found', 'Rota de autenticação não encontrada.');
};

const oracleHandler = async (request, response, url) => {
  const actor = await getSessionUser(request);
  if (!actor) {
    throw new ApiError(401, 'unauthorized', 'Entre na sua conta para consultar a integração Oracle.');
  }
  if (!['admin', 'manager'].includes(getUserRole(actor))) {
    throw new ApiError(403, 'forbidden', 'Somente a liderança de hotelaria pode consultar a integração Oracle.');
  }
  if (request.method === 'GET' && url.pathname === '/api/oracle/status') {
    sendJson(response, 200, getOracleStatus());
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/oracle/sync') {
    if (!isOracleConfigured()) {
      throw new ApiError(503, 'oracle_not_configured', 'Configure as credenciais Oracle no arquivo local do computador host.');
    }
    const companyCode = companyById.get(actor.activeCompanyId)?.oracleCode;
    if (!companyCode || !getOracleCompanyCodes().includes(companyCode)) {
      throw new ApiError(403, 'oracle_company_not_configured', 'A empresa ativa não está habilitada na integração Oracle.');
    }
    sendJson(response, 200, await syncOracleCleaningBeds([companyCode]));
    return;
  }
  throw new ApiError(404, 'not_found', 'Rota de integração Oracle não encontrada.');
};

const completeReviewHandler = async (request, response, url) => {
  const isManualMvConfirmation = url.pathname === '/api/workflow/confirm-mv-release';
  if (!['/api/workflow/complete-review', '/api/workflow/confirm-mv-release'].includes(url.pathname)
    || request.method !== 'POST') {
    throw new ApiError(404, 'not_found', 'Rota de conclusão da revisão não encontrada.');
  }
  const actor = await getSessionUser(request);
  if (!actor) {
    throw new ApiError(401, 'unauthorized', 'Entre na sua conta para concluir a revisão.');
  }
  if (!['admin', 'manager'].includes(getUserRole(actor))) {
    throw new ApiError(403, 'forbidden', 'Somente a liderança de hotelaria pode concluir a revisão.');
  }
  const { taskId } = await readJsonBody(request);
  if (typeof taskId !== 'string' || !taskId) {
    throw new ApiError(400, 'invalid_task', 'Informe o processo que será concluído.');
  }
  const now = new Date();
  const timestamp = now.toISOString();
  const reviewerName = actor.name || actor.email;
  if (isManualMvConfirmation) {
    const result = await updateDatabase((database) => {
      const tasks = getEntityRecords(database, 'CleaningTask');
      const task = tasks.find((record) =>
        record.id === taskId && getRecordCompanyId(record) === actor.activeCompanyId);
      if (!task) throw new ApiError(404, 'task_not_found', 'O processo não foi encontrado.');
      const beds = getEntityRecords(database, 'Bed');
      const bed = beds.find((record) =>
        record.id === task.bed_id && getRecordCompanyId(record) === actor.activeCompanyId);
      if (task.status !== 'em_andamento' || task.workflow_stage !== 'revisao'
        || !task.revisao_started_at || !bed || bed.status !== 'em_revisao') {
        throw new ApiError(409, 'review_not_ready', 'O leito não está aguardando a conclusão da revisão.');
      }
      if (bed.oracle_source !== 'oracle'
        || String(bed.oracle_company_code) !== actor.activeCompanyId
        || String(task.oracle_company_code) !== actor.activeCompanyId
        || !bed.oracle_cd_leito) {
        throw new ApiError(409, 'oracle_bed_identifiers_missing', 'O leito não possui identificação Oracle válida para confirmar a liberação.');
      }
      if (!['erro', 'enviando'].includes(task.mv_sync_status)) {
        throw new ApiError(409, 'oracle_release_not_uncertain', 'A tentativa de liberação não está pendente de confirmação manual.');
      }

      const changes = getAdvanceWorkflowChanges(task, reviewerName, now);
      const updatedTask = {
        ...task,
        ...changes.taskUpdates,
        mv_sync_status: 'sincronizado',
        mv_sync_resolution: 'confirmacao_manual',
        mv_sync_confirmed_by: reviewerName,
        mv_sync_confirmed_at: timestamp,
        mv_sync_completed_at: timestamp,
        mv_sync_error: null,
        updated_date: timestamp,
      };
      const updatedBed = { ...bed, status: 'livre', updated_date: timestamp };
      database.entities.CleaningTask = tasks.map((record) => record.id === taskId ? updatedTask : record);
      database.entities.Bed = beds.map((record) => record.id === bed.id ? updatedBed : record);
      return { task: updatedTask, previousTask: task, bed: updatedBed, previousBed: bed };
    });

    publishChange({
      event: 'entity.updated',
      entity: 'CleaningTask',
      record: result.task,
      previousRecord: result.previousTask,
      changedFields: Object.keys(result.task).filter((field) => result.task[field] !== result.previousTask[field]),
      actor,
    });
    publishChange({
      event: 'bed.status_changed',
      entity: 'Bed',
      record: result.bed,
      previousRecord: result.previousBed,
      changedFields: ['status'],
      actor,
    });
    sendJson(response, 200, { record: result.task, mvReleased: true, manuallyConfirmed: true });
    return;
  }

  const reservation = await updateDatabase((database) => {
    const task = getTenantRecords(database, 'CleaningTask', actor).find((record) => record.id === taskId);
    if (!task) throw new ApiError(404, 'task_not_found', 'O processo não foi encontrado.');
    if (task.status !== 'em_andamento' || task.workflow_stage !== 'revisao' || !task.revisao_started_at) {
      throw new ApiError(409, 'review_not_ready', 'Inicie a revisão antes de aprovar a liberação do quarto.');
    }
    const bed = getTenantRecords(database, 'Bed', actor).find((record) => record.id === task.bed_id);
    if (!bed || bed.status !== 'em_revisao') {
      throw new ApiError(409, 'bed_not_in_review', 'O leito não está aguardando a conclusão da revisão.');
    }

    const isOracleBed = bed.oracle_source === 'oracle';
    if (isOracleBed) {
      if (String(bed.oracle_company_code) !== actor.activeCompanyId) {
        throw new ApiError(403, 'oracle_company_mismatch', 'O leito Oracle não pertence à empresa ativa.');
      }
      if (task.mv_sync_status && task.mv_sync_status !== 'pendente') {
        throw new ApiError(409, 'oracle_release_already_attempted', 'A liberação no MV já foi iniciada ou precisa de conferência manual; não será repetida automaticamente.');
      }
      if (!Number.isInteger(Number(bed.oracle_company_code)) || !bed.oracle_cd_leito) {
        throw new ApiError(409, 'oracle_bed_identifiers_missing', 'O leito não possui empresa ou código Oracle válidos para liberação no MV.');
      }
      if (!isOracleConfigured()) {
        throw new ApiError(503, 'oracle_not_configured', 'Configure a conexão Oracle no computador host para liberar este leito.');
      }
      task.mv_sync_status = 'enviando';
      task.mv_sync_attempted_at = timestamp;
      task.mv_sync_error = null;
    }
    database.entities.CleaningTask = getEntityRecords(database, 'CleaningTask')
      .map((record) => record.id === taskId ? task : record);
    return { task, bed, isOracleBed };
  });

  if (reservation.isOracleBed) {
    try {
      await releaseOracleBed(
        Number(reservation.bed.oracle_company_code),
        String(reservation.bed.oracle_cd_leito),
      );
    } catch (error) {
      const message = error.message || 'A procedure Oracle não conseguiu liberar o leito.';
      const uncertainOutcome = /(?:ORA-(?:03113|03114|03135|12537|12547)|NJS-(?:040|071))/.test(
        `${error.code || ''} ${message}`,
      );
      await updateDatabase((database) => {
        database.entities.CleaningTask = getEntityRecords(database, 'CleaningTask').map((task) =>
          task.id === taskId && task.mv_sync_status === 'enviando'
            ? {
              ...task,
              mv_sync_status: uncertainOutcome ? 'erro' : 'pendente',
              mv_sync_error: message,
              updated_date: new Date().toISOString(),
            }
            : task);
      });
      throw new ApiError(
        502,
        'oracle_release_failed',
        `Não foi possível confirmar a liberação do leito no MV. A revisão não foi concluída. ${message}`,
      );
    }
  }

  const result = await updateDatabase((database) => {
    const tasks = getEntityRecords(database, 'CleaningTask');
    const task = tasks.find((record) =>
      record.id === taskId && getRecordCompanyId(record) === actor.activeCompanyId);
    const beds = getEntityRecords(database, 'Bed');
    const bed = beds.find((record) =>
      record.id === reservation.bed.id && getRecordCompanyId(record) === actor.activeCompanyId);
    if (!task || task.status !== 'em_andamento' || task.workflow_stage !== 'revisao'
      || (reservation.isOracleBed && task.mv_sync_status !== 'enviando')
      || !bed || bed.status !== 'em_revisao') {
      throw new ApiError(409, 'review_changed', 'O processo ou o leito mudou durante a liberação. Verifique o estado no MV antes de tentar novamente.');
    }

    const changes = getAdvanceWorkflowChanges(task, reviewerName, now);
    const updatedTask = {
      ...task,
      ...changes.taskUpdates,
      mv_sync_status: reservation.isOracleBed ? 'sincronizado' : 'nao_aplicavel',
      mv_sync_completed_at: reservation.isOracleBed ? timestamp : null,
      mv_sync_error: null,
      updated_date: timestamp,
    };
    const updatedBed = { ...bed, status: 'livre', updated_date: timestamp };
    database.entities.CleaningTask = tasks.map((record) => record.id === taskId ? updatedTask : record);
    database.entities.Bed = beds.map((record) => record.id === bed.id ? updatedBed : record);
    return { task: updatedTask, previousTask: task, bed: updatedBed, previousBed: bed };
  });

  publishChange({
    event: 'entity.updated',
    entity: 'CleaningTask',
    record: result.task,
    previousRecord: result.previousTask,
    changedFields: Object.keys(result.task).filter((field) => result.task[field] !== result.previousTask[field]),
    actor,
  });
  publishChange({
    event: 'bed.status_changed',
    entity: 'Bed',
    record: result.bed,
    previousRecord: result.previousBed,
    changedFields: ['status'],
    actor,
  });
  sendJson(response, 200, { record: result.task, mvReleased: reservation.isOracleBed });
};

const purgeManualStructureHandler = async (request, response, url) => {
  if (url.pathname !== '/api/structure/purge-manual' || request.method !== 'POST') {
    throw new ApiError(404, 'not_found', 'Rota de exclusão de cadastros manuais não encontrada.');
  }
  const actor = await getSessionUser(request);
  if (!actor) {
    throw new ApiError(401, 'unauthorized', 'Entre na sua conta para excluir os cadastros manuais.');
  }
  if (getUserRole(actor) !== 'admin') {
    throw new ApiError(403, 'forbidden', 'Somente o administrador de TI pode excluir os cadastros manuais.');
  }

  const deleted = await updateDatabase((database) => {
    const beds = getEntityRecords(database, 'Bed');
    const units = getEntityRecords(database, 'Unit');
    const tasks = getEntityRecords(database, 'CleaningTask');
    const deletedBeds = beds.filter((bed) =>
      getRecordCompanyId(bed) === actor.activeCompanyId && bed.oracle_source !== 'oracle');
    const deletedUnits = units.filter((unit) =>
      getRecordCompanyId(unit) === actor.activeCompanyId && unit.oracle_source !== 'oracle');
    const deletedBedIds = new Set(deletedBeds.map((bed) => bed.id));
    const preservedHistoryCount = tasks.filter((task) =>
      getRecordCompanyId(task) === actor.activeCompanyId && deletedBedIds.has(task.bed_id)).length;

    database.entities.Bed = beds.filter((bed) => !deletedBedIds.has(bed.id));
    const deletedUnitIds = new Set(deletedUnits.map((unit) => unit.id));
    database.entities.Unit = units.filter((unit) => !deletedUnitIds.has(unit.id));

    return { beds: deletedBeds, units: deletedUnits, preservedHistoryCount };
  });

  for (const bed of deleted.beds) {
    publishChange({ event: 'entity.deleted', entity: 'Bed', record: bed, actor });
  }
  for (const unit of deleted.units) {
    publishChange({ event: 'entity.deleted', entity: 'Unit', record: unit, actor });
  }
  sendJson(response, 200, {
    deletedBeds: deleted.beds.length,
    deletedUnits: deleted.units.length,
    preservedHistoryCount: deleted.preservedHistoryCount,
  });
};

export const authApi = (request, response, next) => {
  const url = new URL(request.url, 'http://localhost');
  if (request.method === 'GET' && url.pathname === '/api/events') {
    getSessionUser(request).then((user) => {
      if (!user) {
        sendJson(response, 401, { code: 'unauthorized', error: 'Entre na sua conta para receber atualizações.' });
        return;
      }
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      response.write(': conectado\n\n');
      const token = getSessionToken(request);
      eventClients.set(response, { userId: user.id, token });
      const heartbeat = setInterval(() => {
        const session = sessions.get(token);
        if (!session || session.expiresAt <= Date.now()) {
          sessions.delete(token);
          eventClients.delete(response);
          response.end();
          return;
        }
        response.write(': heartbeat\n\n');
      }, 25000);
      request.on('close', () => {
        clearInterval(heartbeat);
        eventClients.delete(response);
      });
    }).catch((error) => {
      console.error('Falha ao autenticar o canal de atualizações em tempo real.', error);
      if (!response.headersSent) sendJson(response, 500, { code: 'internal_error', error: 'Não foi possível abrir o canal de atualizações.' });
      else response.end();
    });
    return;
  }

  const isAuthRoute = url.pathname.startsWith('/api/auth/');
  const isAdminRoute = url.pathname.startsWith('/api/admin/');
  const isEntityRoute = url.pathname.startsWith('/api/entities/');
  const isOracleRoute = url.pathname.startsWith('/api/oracle/');
  const isWorkflowRoute = url.pathname.startsWith('/api/workflow/');
  const isStructureRoute = url.pathname.startsWith('/api/structure/');
  if (!isAuthRoute && !isAdminRoute && !isEntityRoute && !isOracleRoute && !isWorkflowRoute && !isStructureRoute) {
    next();
    return;
  }

  let handler = entityHandler;
  if (isAuthRoute) handler = authHandler;
  else if (isOracleRoute) handler = oracleHandler;
  else if (isWorkflowRoute) handler = completeReviewHandler;
  else if (isStructureRoute) handler = purgeManualStructureHandler;
  else if (isAdminRoute) {
    handler = async (adminRequest, adminResponse, adminUrl) => {
      const actor = await getSessionUser(adminRequest);
      if (!actor) throw new ApiError(401, 'unauthorized', 'Entre como administrador para gerenciar usuários.');
      await adminHandler(adminRequest, adminResponse, adminUrl, actor);
    };
  }
  handler(request, response, url).catch((error) => {
    if (error instanceof ApiError) {
      sendJson(response, error.status, { code: error.code, error: error.message });
      return;
    }
    console.error('Falha no serviço compartilhado de autenticação.', error);
    sendJson(response, 500, { code: 'internal_error', error: 'Não foi possível concluir a operação de autenticação.' });
  });
};