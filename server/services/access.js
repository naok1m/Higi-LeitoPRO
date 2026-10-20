import { companies, companyById } from '../config/companies.js';
import { ApiError } from '../http/errors.js';

export const entityNames = ['Bed', 'CleaningTask', 'Employee', 'Material', 'MaterialCheck', 'Unit'];
export const userRoles = ['admin', 'manager', 'collaborator', 'rouparia'];

export const publicUser = ({ passwordHash, passwordSalt, ...user }) => user;

export const getUserRole = (user) => user.role === 'user' ? 'manager' : user.role;

export const getUserCompanyIds = (user) => {
  if (getUserRole(user) === 'admin') return companies.map(({ id }) => id);
  const assigned = Array.isArray(user.companyIds)
    ? [...new Set(user.companyIds.filter((id) => companyById.has(id)))]
    : [];
  return assigned.length ? assigned : ['1'];
};

export const getSessionUserData = (user, activeCompanyId) => {
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

export const getRecordCompanyId = (record) =>
  String(record.company_id || record.oracle_company_code || '1');

export const getEntityRecords = (database, entity) => {
  const records = database.entities[entity] || [];
  if (!Array.isArray(records)) throw new Error(`Os registros de ${entity} no armazenamento compartilhado são inválidos.`);
  return records;
};

export const getCompanyRecords = (database, entity, companyId) =>
  getEntityRecords(database, entity)
    .filter((record) => getRecordCompanyId(record) === companyId);

export const getTenantRecords = (database, entity, actor) =>
  getCompanyRecords(database, entity, actor.activeCompanyId);

export const validateCompanyIds = (companyIds, actor) => {
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

export const assertActiveCompany = (companyId, actor) => {
  if (companyId !== undefined && String(companyId) !== actor.activeCompanyId) {
    throw new ApiError(403, 'company_mismatch', 'O registro deve pertencer à empresa ativa.');
  }
};

export const validateEntity = (entity) => {
  if (!entityNames.includes(entity)) throw new ApiError(404, 'entity_not_found', 'Tipo de registro não encontrado.');
};

export const requireAdministrator = (user) => {
  if (getUserRole(user) !== 'admin') {
    throw new ApiError(403, 'forbidden', 'Somente o administrador de TI pode gerenciar usuários.');
  }
};

export const validateRole = (role) => {
  if (!userRoles.includes(role)) {
    throw new ApiError(400, 'invalid_role', 'Selecione um tipo de usuário válido.');
  }
};
