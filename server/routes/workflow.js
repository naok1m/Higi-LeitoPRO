import { getAdvanceWorkflowChanges } from '../../src/lib/bedWorkflow.js';
import { updateEntities } from '../db/entityStore.js';
import { ApiError } from '../http/errors.js';
import { readJsonBody, sendJson } from '../http/io.js';
import { isOracleConfigured, releaseOracleBed } from '../integrations/oracle.js';
import { getEntityRecords, getRecordCompanyId, getTenantRecords, getUserRole } from '../services/access.js';
import { getSessionUser } from '../services/authSessions.js';
import { publishChange } from '../services/changes.js';

// Revisão: o processo (por id) e todos os leitos da empresa ativa.
const reviewScope = (companyId, taskId) => ({
  entities: ['CleaningTask', 'Bed'],
  companyId,
  filters: { CleaningTask: [{ id: taskId }] },
});

export const workflowHandler = async (request, response, url) => {
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
    const result = await updateEntities(reviewScope(actor.activeCompanyId, taskId), (database) => {
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

    await publishChange({
      event: 'entity.updated',
      entity: 'CleaningTask',
      record: result.task,
      previousRecord: result.previousTask,
      changedFields: Object.keys(result.task).filter((field) => result.task[field] !== result.previousTask[field]),
      actor,
    });
    await publishChange({
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

  const reservation = await updateEntities(reviewScope(actor.activeCompanyId, taskId), (database) => {
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
      await updateEntities({
        entities: ['CleaningTask'],
        companyId: actor.activeCompanyId,
        filters: { CleaningTask: [{ id: taskId }] },
      }, (database) => {
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

  const result = await updateEntities(reviewScope(actor.activeCompanyId, taskId), (database) => {
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

  await publishChange({
    event: 'entity.updated',
    entity: 'CleaningTask',
    record: result.task,
    previousRecord: result.previousTask,
    changedFields: Object.keys(result.task).filter((field) => result.task[field] !== result.previousTask[field]),
    actor,
  });
  await publishChange({
    event: 'bed.status_changed',
    entity: 'Bed',
    record: result.bed,
    previousRecord: result.previousBed,
    changedFields: ['status'],
    actor,
  });
  sendJson(response, 200, { record: result.task, mvReleased: reservation.isOracleBed });
};
