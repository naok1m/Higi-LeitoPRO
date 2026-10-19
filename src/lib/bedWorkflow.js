export const WORKFLOW_STAGES = {
  higienizacao: 'Higienização',
  rouparia: 'Rouparia',
  revisao: 'Revisão do líder',
  manutencao: 'Aguardando manutenção',
};

const BED_STATUS_BY_STAGE = {
  higienizacao: 'em_limpeza',
  rouparia: 'em_rouparia',
  revisao: 'aguardando_revisao',
  manutencao: 'aguardando_manutencao',
};

export const getWorkflowStage = (task) => task?.workflow_stage || 'higienizacao';

export const getBedStatusForStage = (stage) => BED_STATUS_BY_STAGE[stage] || 'em_limpeza';

export const getHospitalityDurationSeconds = (task, endAt = Date.now()) => {
  const start = Date.parse(task?.requested_at || task?.started_at);
  const end = task?.maintenance_started_at ? Date.parse(task.maintenance_started_at) : endAt;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 1000));
};

export const getStageDurationSeconds = (task, stage, endAt = Date.now()) => {
  const startValue = task?.[`${stage}_started_at`] || (stage === 'higienizacao' ? task?.started_at : null);
  const start = Date.parse(startValue);
  const savedDuration = Number(task?.[`${stage}_duration_seconds`]) || 0;
  if (task?.[`${stage}_finished_at`] || !Number.isFinite(start)) return savedDuration;
  const stageEnd = endAt;
  const maintenanceStart = Date.parse(task?.maintenance_started_at);
  const end = Number.isFinite(maintenanceStart) ? Math.min(stageEnd, maintenanceStart) : stageEnd;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return savedDuration + Math.round((end - start) / 1000);
};

export const getStageIdleSeconds = (task, stage, endAt = Date.now()) => {
  const idleStart = Date.parse(task?.[`${stage}_idle_started_at`]);
  if (!Number.isFinite(idleStart)) return Number(task?.[`${stage}_idle_seconds`]) || 0;
  const maintenanceStart = Date.parse(task?.maintenance_started_at);
  const end = Number.isFinite(maintenanceStart) ? Math.min(endAt, maintenanceStart) : endAt;
  if (end < idleStart) return Number(task?.[`${stage}_idle_seconds`]) || 0;
  return (Number(task?.[`${stage}_idle_seconds`]) || 0) + Math.round((end - idleStart) / 1000);
};

export const getStartStageChanges = (task, stage) => {
  if (getWorkflowStage(task) !== stage || task[`${stage}_started_at`]) {
    throw new Error('Esta etapa já foi iniciada ou não está aguardando início.');
  }
  if (!['rouparia', 'revisao'].includes(stage)) {
    throw new Error('Etapa inválida para início.');
  }
  return {
    bedStatus: stage === 'rouparia' ? 'em_rouparia' : 'em_revisao',
    taskUpdates: {
      workflow_action: 'start',
      workflow_stage: stage,
    },
  };
};

export const getAdvanceWorkflowChanges = (task, reviewerName, now = new Date()) => {
  const stage = getWorkflowStage(task);
  const timestamp = now.toISOString();

  if (stage === 'higienizacao') {
    return {
      bedStatus: 'aguardando_rouparia',
      taskUpdates: {
        workflow_stage: 'rouparia',
        higienizacao_finished_at: timestamp,
        higienizacao_duration_seconds: getStageDurationSeconds(task, 'higienizacao', now.getTime()),
        rouparia_idle_started_at: timestamp,
      },
    };
  }
  if (stage === 'rouparia') {
    if (!task.rouparia_started_at) {
      throw new Error('Inicie a etapa de rouparia antes de concluí-la.');
    }
    return {
      bedStatus: getBedStatusForStage('revisao'),
      taskUpdates: {
        workflow_stage: 'revisao',
        rouparia_finished_at: timestamp,
        rouparia_duration_seconds: getStageDurationSeconds(task, 'rouparia', now.getTime()),
        revisao_idle_started_at: timestamp,
      },
    };
  }
  if (stage === 'revisao') {
    if (!reviewerName) throw new Error('Somente o líder de hotelaria pode aprovar a revisão.');
    if (!task.revisao_started_at) {
      throw new Error('Inicie a revisão antes de aprovar a liberação do quarto.');
    }
    const stageDurations = ['higienizacao', 'rouparia', 'revisao']
      .map((name) => name === stage
        ? getStageDurationSeconds(task, name, now.getTime())
        : Number(task[`${name}_duration_seconds`]) || 0);
    const idleDurations = ['higienizacao', 'rouparia', 'revisao']
      .map((name) => Number(task[`${name}_idle_seconds`]) || 0);
    return {
      bedStatus: 'livre',
      taskUpdates: {
        status: 'concluida',
        finished_at: timestamp,
        reviewed_by: reviewerName,
        revisao_finished_at: timestamp,
        revisao_duration_seconds: getStageDurationSeconds(task, 'revisao', now.getTime()),
        active_duration_seconds: stageDurations.reduce((total, duration) => total + duration, 0),
        idle_duration_seconds: idleDurations.reduce((total, duration) => total + duration, 0),
        duration_seconds: getHospitalityDurationSeconds(task, now.getTime())
          - (Number(task.maintenance_total_seconds) || 0),
      },
    };
  }
  throw new Error('Retome o processo após a manutenção antes de avançar a etapa.');
};

export const getMaintenanceWorkflowChanges = (task, reason, requestedBy, now = new Date()) => {
  if (getWorkflowStage(task) === 'manutencao') {
    throw new Error('A manutenção deste leito já está em andamento.');
  }
  if (!reason?.trim()) throw new Error('Informe o problema que exige manutenção.');
  const timestamp = now.toISOString();
  const stage = getWorkflowStage(task);
  const stageHasStarted = Boolean(task[`${stage}_started_at`] || (stage === 'higienizacao' && task.started_at));
  const stageDuration = stageHasStarted ? getStageDurationSeconds(task, stage, now.getTime()) : null;
  const idleDuration = stageHasStarted ? null : getStageIdleSeconds(task, stage, now.getTime());
  return {
    bedStatus: getBedStatusForStage('manutencao'),
    taskUpdates: {
      workflow_stage: 'manutencao',
      maintenance_return_stage: stage,
      maintenance_reason: reason,
      maintenance_requested_by: requestedBy,
      maintenance_started_at: timestamp,
      maintenance_return_active: stageHasStarted,
      [`${stage}_duration_seconds`]: stageHasStarted ? stageDuration : task[`${stage}_duration_seconds`],
      [`${stage}_started_at`]: stageHasStarted ? null : task[`${stage}_started_at`],
      [`${stage}_idle_seconds`]: stageHasStarted ? task[`${stage}_idle_seconds`] : idleDuration,
      [`${stage}_idle_started_at`]: null,
      maintenance_total_seconds: Number(task.maintenance_total_seconds) || 0,
    },
  };
};

export const getResumeMaintenanceChanges = (task, now = new Date()) => {
  if (getWorkflowStage(task) !== 'manutencao') {
    throw new Error('Este leito não está aguardando manutenção.');
  }
  const stage = task.maintenance_return_stage || 'higienizacao';
  const timestamp = now.toISOString();
  const maintenanceStartedAt = Date.parse(task.maintenance_started_at);
  return {
    bedStatus: stage === 'rouparia' && !task.maintenance_return_active
      ? 'aguardando_rouparia'
      : stage === 'revisao' && !task.maintenance_return_active
        ? 'aguardando_revisao'
        : getBedStatusForStage(stage),
    taskUpdates: {
      workflow_stage: stage,
      maintenance_total_seconds: (Number(task.maintenance_total_seconds) || 0)
        + (Number.isFinite(maintenanceStartedAt)
          ? Math.max(0, Math.round((now.getTime() - maintenanceStartedAt) / 1000))
          : 0),
      maintenance_started_at: null,
      maintenance_return_active: null,
      ...(task.maintenance_return_active
        ? { [`${stage}_started_at`]: timestamp }
        : { [`${stage}_idle_started_at`]: timestamp }),
      maintenance_completed_at: timestamp,
    },
  };
};
