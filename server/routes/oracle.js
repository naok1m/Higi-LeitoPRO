import { companyById } from '../config/companies.js';
import { ApiError } from '../http/errors.js';
import { readJsonBody, sendJson } from '../http/io.js';
import {
  fetchOracleDischargeForecast,
  fetchOracleOccupiedBeds,
  getOracleCompanyCodes,
  isOracleAdHocBedAvailable,
  isOracleConfigured,
  requestOracleAdHocCleaning,
} from '../integrations/oracle.js';
import { getUserRole } from '../services/access.js';
import { getSessionUser } from '../services/authSessions.js';
import { logger } from '../lib/logger.js';
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
  if (request.method === 'GET' && url.pathname === '/api/oracle/discharge-forecast') {
    if (!isOracleConfigured()) {
      throw new ApiError(503, 'oracle_not_configured', 'Configure as credenciais Oracle no arquivo local do computador host.');
    }
    const companyCode = companyById.get(actor.activeCompanyId)?.oracleCode;
    if (!companyCode || !getOracleCompanyCodes().includes(companyCode)) {
      throw new ApiError(403, 'oracle_company_not_configured', 'A empresa ativa não está habilitada na integração Oracle.');
    }
    try {
      sendJson(response, 200, { rows: await fetchOracleDischargeForecast(companyCode) });
    } catch (error) {
      logger.error('Falha ao consultar previsão de alta no Oracle.', error);
      throw new ApiError(502, 'oracle_query_failed', 'Não foi possível consultar a previsão de alta no Oracle.');
    }
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/oracle/occupied-beds') {
    if (!isOracleConfigured()) {
      throw new ApiError(503, 'oracle_not_configured', 'Configure as credenciais Oracle no arquivo local do computador host.');
    }
    const companyCode = companyById.get(actor.activeCompanyId)?.oracleCode;
    if (!companyCode || !getOracleCompanyCodes().includes(companyCode)) {
      throw new ApiError(403, 'oracle_company_not_configured', 'A empresa ativa não está habilitada na integração Oracle.');
    }
    try {
      const rows = await fetchOracleOccupiedBeds(companyCode);
      sendJson(response, 200, { rows: rows.filter(isOracleAdHocBedAvailable) });
    } catch (error) {
      logger.error('Falha ao consultar leitos ocupados disponíveis para solicitação avulsa.', error);
      throw new ApiError(502, 'oracle_occupied_beds_query_failed', 'Não foi possível consultar os leitos ocupados no MV.');
    }
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/oracle/ad-hoc-cleaning') {
    if (!isOracleConfigured()) {
      throw new ApiError(503, 'oracle_not_configured', 'Configure as credenciais Oracle no arquivo local do computador host.');
    }
    const companyCode = companyById.get(actor.activeCompanyId)?.oracleCode;
    if (!companyCode || !getOracleCompanyCodes().includes(companyCode)) {
      throw new ApiError(403, 'oracle_company_not_configured', 'A empresa ativa não está habilitada na integração Oracle.');
    }
    const body = await readJsonBody(request);
    const { bedCode, cleaningType = null, observation = '' } =
      body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    if (typeof bedCode !== 'string' || !/^\d+$/.test(bedCode)
      || (cleaningType !== null && ![1, 3].includes(cleaningType))
      || typeof observation !== 'string' || observation.length > 1000) {
      throw new ApiError(400, 'invalid_ad_hoc_cleaning', 'Informe um leito válido, um tipo de limpeza permitido e uma observação de até 1000 caracteres.');
    }

    let occupiedBeds;
    try {
      occupiedBeds = await fetchOracleOccupiedBeds(companyCode);
    } catch (error) {
      logger.error('Falha ao validar leito ocupado para solicitação avulsa.', error);
      throw new ApiError(502, 'oracle_occupied_beds_query_failed', 'Não foi possível validar a ocupação do leito no MV.');
    }
    const bed = occupiedBeds.find((row) => String(row.CD_LEITO) === bedCode);
    if (!bed) {
      throw new ApiError(409, 'oracle_bed_not_occupied', 'O MV não retornou este leito como ocupado. Atualize a lista e confira a situação diretamente no MV.');
    }
    if (!isOracleAdHocBedAvailable(bed)) {
      throw new ApiError(409, 'oracle_ad_hoc_already_open', 'O MV informa que este leito já possui uma solicitação avulsa aberta.');
    }
    const requesterName = actor.name?.trim() || actor.email;
    const oracleObservation = `Solicitante: ${requesterName}\nMotivo: ${observation.trim()}`;
    if (oracleObservation.length > 1000) {
      throw new ApiError(400, 'invalid_ad_hoc_observation', 'O nome do solicitante e o motivo juntos devem ter até 1000 caracteres.');
    }

    try {
      const requestId = await requestOracleAdHocCleaning({
        companyCode,
        bedCode,
        operatorLogin: 'MV INTEGRA',
        cleaningType,
        observation: oracleObservation,
      });
      sendJson(response, 200, { requestId });
    } catch (error) {
      if (error.errorNum === 20107) {
        logger.warn('Oracle recusou solicitação avulsa porque o leito não está ocupado no MV.', error);
        throw new ApiError(409, 'oracle_bed_not_occupied', 'O MV informa que este leito não está ocupado. Confira a situação do leito diretamente no MV.');
      }
      logger.error('Falha ao criar solicitação avulsa no Oracle.', error);
      throw new ApiError(502, 'oracle_ad_hoc_failed', 'Não foi possível confirmar a solicitação avulsa no Oracle. Se houve interrupção de conexão, confira no MV antes de tentar novamente.');
    }
    return;
  }
  throw new ApiError(404, 'not_found', 'Rota de integração Oracle não encontrada.');
};
