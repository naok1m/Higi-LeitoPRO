import { randomUUID } from 'node:crypto';
import { NO_DATABASE_CHANGE, readEntities, updateEntities } from '../db/entityStore.js';
import { ApiError } from '../http/errors.js';
import { isHostConnection, readJsonBody, sendJson } from '../http/io.js';
import { getState, setState } from '../repositories/appState.js';
import {
  assertActiveCompany,
  entityNames,
  getCompanyRecords,
  getEntityRecords,
  getRecordCompanyId,
  getTenantRecords,
  getUserRole,
  requireAdministrator,
  validateEntity,
} from '../services/access.js';
import { getSessionUser } from '../services/authSessions.js';
import { publishChange } from '../services/changes.js';
import { aggregateRecords, matchesQuery, sortRecords } from '../services/entityQuery.js';

const ENTITIES_MIGRATED_KEY = 'entities_migrated';

// Processos e conferências crescem sem parar (histórico). Quando a consulta pede um
// status exato, o banco já devolve só esse recorte; o filtro em memória continua
// aplicando a regra completa por cima.
const readScope = (entity, actor, query) => ({
  entities: [entity],
  companyId: actor.activeCompanyId,
  filters: ['CleaningTask', 'MaterialCheck'].includes(entity) && typeof query?.status === 'string'
    ? { [entity]: [{ status: query.status }] }
    : {},
});

// O que cada criação precisa consultar além da própria entidade.
const createScope = (entity, companyId, values) => {
  switch (entity) {
    case 'CleaningTask':
      return {
        entities: ['CleaningTask', 'Bed', 'Employee'],
        companyId,
        filters: { CleaningTask: [{ status: 'em_andamento' }] },
      };
    case 'MaterialCheck':
      return {
        entities: ['MaterialCheck', 'CleaningTask', 'Material'],
        companyId,
        filters: { MaterialCheck: [], CleaningTask: [{ id: String(values.task_id) }] },
      };
    default:
      return { entities: [entity], companyId };
  }
};

const patchScope = (entity, companyId, id) => {
  switch (entity) {
    case 'CleaningTask':
      return {
        entities: ['CleaningTask', 'Employee'],
        companyId,
        filters: { CleaningTask: [{ status: 'em_andamento' }, { id }] },
      };
    case 'Bed':
      return {
        entities: ['Bed', 'CleaningTask', 'MaterialCheck'],
        companyId,
        filters: {
          CleaningTask: [{ status: 'em_andamento' }, { bed_id: id }],
          MaterialCheck: [{ bed_id: id }],
        },
      };
    case 'MaterialCheck':
      return { entities: ['MaterialCheck'], companyId, filters: { MaterialCheck: [{ id }] } };
    default:
      return { entities: [entity], companyId };
  }
};

const deleteScope = (entity, companyId, id) => {
  switch (entity) {
    case 'Bed':
      return { entities: ['Bed', 'CleaningTask'], companyId, filters: { CleaningTask: [{ bed_id: id }] } };
    case 'CleaningTask':
    case 'MaterialCheck':
      return { entities: [entity], companyId, filters: { [entity]: [{ id }] } };
    default:
      return { entities: [entity], companyId };
  }
};

export const entityHandler = async (request, response, url) => {
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

    const migrated = Boolean(await updateEntities({ entities: entityNames }, async (database, client) => {
      if (await getState(ENTITIES_MIGRATED_KEY, client)) return NO_DATABASE_CHANGE;
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
      await setState(ENTITIES_MIGRATED_KEY, true, client);
      return true;
    }));
    if (migrated) {
      await publishChange({
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
    const database = await readEntities(readScope(entity, actor, query));
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
    const body = await readJsonBody(request);
    const database = await readEntities(readScope(entity, actor, body?.query));
    sendJson(response, 200, aggregateRecords(getTenantRecords(database, entity, actor), body));
    return;
  }

  if (request.method === 'POST' && action === 'create') {
    let values = await readJsonBody(request);
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
    const now = new Date().toISOString();
    if (entity === 'LostFoundItem') {
      if (!['admin', 'manager'].includes(actorRole)) {
        throw new ApiError(403, 'forbidden', 'Somente administradores e gestores podem registrar achados e perdidos.');
      }
      if (!['achado', 'perdido'].includes(values.event_type)
        || typeof values.description !== 'string' || !values.description.trim()
        || values.description.trim().length > 300
        || typeof values.location !== 'string' || !values.location.trim()
        || values.location.trim().length > 200
        || (values.bed_code !== undefined
          && (typeof values.bed_code !== 'string' || values.bed_code.trim().length > 50))) {
        throw new ApiError(400, 'invalid_lost_found_item', 'Informe o tipo, a descrição e o local do item.');
      }
      values = {
        event_type: values.event_type,
        description: values.description.trim(),
        location: values.location.trim(),
        ...(values.bed_code?.trim() ? { bed_code: values.bed_code.trim() } : {}),
        reported_by: actor.name || actor.email,
        reported_at: now,
        status: 'aberto',
      };
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
    await updateEntities(createScope(entity, recordCompanyId, values), (database) => {
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
    await publishChange({ event: 'entity.created', entity, record, actor });
    sendJson(response, 201, { record });
    return;
  }

  if (request.method === 'PATCH' && action === 'record' && id) {
    let values = await readJsonBody(request);
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      throw new ApiError(400, 'invalid_record', 'Os dados do registro são inválidos.');
    }
    assertActiveCompany(values.company_id, actor);
    if (entity === 'LostFoundItem'
      && (Object.keys(values).some((field) => !['status', 'resolved_at'].includes(field))
        || values.status !== 'resolvido' || typeof values.resolved_at !== 'string'
        || !Number.isFinite(Date.parse(values.resolved_at)))) {
      throw new ApiError(400, 'invalid_lost_found_update', 'Só é permitido registrar a resolução do item.');
    }
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
    const { record: updated, previousRecord } = await updateEntities(patchScope(entity, actor.activeCompanyId, id), (database) => {
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
    await publishChange({
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
    const record = await updateEntities(deleteScope(entity, actor.activeCompanyId, id), (database) => {
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
    await publishChange({ event: 'entity.deleted', entity, record, actor });
    sendJson(response, 200, { success: true });
    return;
  }

  throw new ApiError(404, 'not_found', 'Rota de dados compartilhados não encontrada.');
};
