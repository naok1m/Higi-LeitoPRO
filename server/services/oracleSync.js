import { companies, supportedOracleCompanyCodes } from '../config/companies.js';
import { NO_DATABASE_CHANGE, updateEntities } from '../db/entityStore.js';
import {
  fetchOracleCleaningBeds,
  getOracleCompanyCodes,
  getOraclePollIntervalMs,
  isOracleConfigured,
} from '../integrations/oracle.js';
import { getState, setState } from '../repositories/appState.js';
import { getEntityRecords, getRecordCompanyId } from './access.js';
import { notifyClients } from './changes.js';

const ORACLE_STATUS_KEY = 'oracle_last_sync';
let oracleSyncPromise = null;
let oracleLastSync = {
  attemptedAt: null,
  succeededAt: null,
  error: null,
  imported: 0,
  updated: 0,
};

const stringValue = (value) => (value === null || value === undefined ? '' : String(value).trim());

export const normalizeOracleCleaningRow = (row, companyCode) => {
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

// Só os processos em andamento são carregados: a sincronização apenas consulta
// essas tarefas e nunca as altera.
export const upsertOracleCleaningBeds = async (rows, companyCode) => updateEntities({
  entities: ['Unit', 'Bed', 'CleaningTask'],
  companyId: companies.find((item) => item.oracleCode === companyCode)?.id,
  filters: { CleaningTask: [{ status: 'em_andamento' }] },
}, (database) => {
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

const saveOracleStatus = async () => {
  await setState(ORACLE_STATUS_KEY, oracleLastSync).catch(() => {});
};

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
    await saveOracleStatus();
    if (imported || updated) await notifyClients('oracle.synced');
    return oracleLastSync;
  } catch (error) {
    oracleLastSync = {
      ...oracleLastSync,
      error: error.message || 'Não foi possível consultar o Oracle.',
    };
    await saveOracleStatus();
    throw error;
  }
};

export const syncOracleCleaningBeds = (companyCodes = getOracleCompanyCodes()) => {
  if (!oracleSyncPromise) {
    oracleSyncPromise = performOracleCleaningSync(companyCodes).finally(() => {
      oracleSyncPromise = null;
    });
  }
  return oracleSyncPromise;
};

// O status vem do banco porque quem sincroniza normalmente é o worker, outro processo.
export const getOracleStatus = async () => ({
  ...oracleLastSync,
  ...(await getState(ORACLE_STATUS_KEY)),
  configured: isOracleConfigured(),
  pollIntervalMs: isOracleConfigured() ? getOraclePollIntervalMs() : null,
});
