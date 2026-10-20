import { companyById } from '../config/companies.js';
import { ApiError } from '../http/errors.js';
import { sendJson } from '../http/io.js';
import { getOracleCompanyCodes, isOracleConfigured } from '../integrations/oracle.js';
import { getUserRole } from '../services/access.js';
import { getSessionUser } from '../services/authSessions.js';
import { getOracleStatus, syncOracleCleaningBeds } from '../services/oracleSync.js';

export const oracleHandler = async (request, response, url) => {
  const actor = await getSessionUser(request);
  if (!actor) {
    throw new ApiError(401, 'unauthorized', 'Entre na sua conta para consultar a integração Oracle.');
  }
  if (!['admin', 'manager'].includes(getUserRole(actor))) {
    throw new ApiError(403, 'forbidden', 'Somente a liderança de hotelaria pode consultar a integração Oracle.');
  }
  if (request.method === 'GET' && url.pathname === '/api/oracle/status') {
    sendJson(response, 200, await getOracleStatus());
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
