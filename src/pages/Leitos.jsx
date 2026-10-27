import { db } from '@/api/localClient';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import BedCard, { STATUS } from '@/components/beds/BedCard';
import OracleDischargePanel from '@/components/beds/OracleDischargePanel';
import StartDialog from '@/components/beds/StartDialog';
import MaterialCheckDialog from '@/components/materials/MaterialCheckDialog';
import MissingAlert from '@/components/beds/MissingAlert';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import {
  getAdvanceWorkflowChanges,
  getMaintenanceWorkflowChanges,
  getResumeMaintenanceChanges,
  getStartStageChanges,
} from '@/lib/bedWorkflow';

export default function Leitos() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isLeader = ['admin', 'manager', 'user'].includes(user?.role);
  const [unitId, setUnitId] = useState('all');
  const [starting, setStarting] = useState(null);
  const [checking, setChecking] = useState(null);

  const { data: units } = useQuery({ queryKey: ['units'], queryFn: () => db.entities.Unit.filter({}, { sort: 'name', limit: 100 }) });
  const { data: beds, isLoading } = useQuery({
    queryKey: ['beds', unitId],
    queryFn: () => db.entities.Bed.filter(unitId === 'all' ? {} : { unit_id: unitId }, { sort: 'code', limit: 300 }),
    refetchInterval: 5000,
  });
  const { data: tasks } = useQuery({
    queryKey: ['active-tasks'],
    queryFn: () => db.entities.CleaningTask.filter({ status: 'em_andamento' }, { limit: 300 }),
    refetchInterval: 15000,
  });
  const { data: counts } = useQuery({
    queryKey: ['bed-counts', unitId],
    queryFn: () => db.entities.Bed.aggregate({ query: unitId === 'all' ? {} : { unit_id: unitId }, groupBy: 'status' }),
  });
  const { data: oracleStatus } = useQuery({
    queryKey: ['oracle-status'],
    queryFn: () => db.oracle.status(),
    enabled: isLeader,
    refetchInterval: 5000,
  });

  const refresh = () => ['beds', 'active-tasks', 'bed-counts', 'missing-items', 'requests', 'structure-beds'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const syncOracle = useMutation({
    mutationFn: () => db.oracle.sync(),
    onSuccess: (result) => {
      refresh();
      qc.invalidateQueries({ queryKey: ['oracle-status'] });
      toast.success(`Oracle sincronizado · ${result.imported} leito(s) novo(s), ${result.updated} atualizado(s)`);
    },
    onError: (error) => toast.error(error.message || 'Não foi possível sincronizar o Oracle.'),
  });
  const taskByBed = Object.fromEntries((tasks?.items || []).map((t) => [t.bed_id, t]));
  const visibleBeds = (beds?.items || []).filter((bed) => bed.status !== 'livre');
  const hygieneTasks = (tasks?.items || []).filter((task) =>
    task.workflow_stage === 'higienizacao' || !task.workflow_stage);

  const start = useMutation({
    mutationFn: async ({ bed, employee, type }) => {
      const startedAt = new Date().toISOString();
      await db.entities.CleaningTask.create({
        bed_id: bed.id, bed_code: bed.code, unit_name: bed.unit_name, employee_id: employee.id,
        employee_name: employee.name, cleaning_type: type, status: 'em_andamento',
        workflow_stage: 'higienizacao', higienizacao_started_at: startedAt,
        started_at: startedAt, mv_sync_status: 'pendente',
      });
      await db.entities.Bed.update(bed.id, { status: 'em_limpeza' });
    },
    onSuccess: () => { setStarting(null); refresh(); toast.success('Processo de hotelaria iniciado'); },
    onError: (error) => toast.error(error.message || 'Não foi possível iniciar a limpeza.'),
  });
  const advance = useMutation({
    mutationFn: async (task) => {
      if (task.workflow_stage === 'revisao') {
        return db.workflow.completeReview(task.id);
      }
      const reviewerName = isLeader ? (user.name || user.email) : '';
      const changes = getAdvanceWorkflowChanges(task, reviewerName);
      await db.entities.CleaningTask.update(task.id, changes.taskUpdates);
      await db.entities.Bed.update(task.bed_id, { status: changes.bedStatus });
    },
    onSuccess: (result, task) => {
      refresh();
      toast.success(task.workflow_stage === 'revisao'
        ? result?.mvReleased ? 'Revisão aprovada · leito liberado no MV' : 'Revisão aprovada · leito liberado'
        : 'Etapa concluída');
    },
    onError: (error) => toast.error(error.message || 'Não foi possível avançar o processo.'),
  });
  const confirmMvRelease = useMutation({
    mutationFn: (task) => db.workflow.confirmMvRelease(task.id),
    onSuccess: () => {
      refresh();
      toast.success('Liberação confirmada · leito liberado no Higi Leito PRO');
    },
    onError: (error) => toast.error(error.message || 'Não foi possível confirmar a liberação no MV.'),
  });
  const startStage = useMutation({
    mutationFn: async ({ task, stage }) => {
      const changes = getStartStageChanges(task, stage);
      await db.entities.CleaningTask.update(task.id, changes.taskUpdates);
      await db.entities.Bed.update(task.bed_id, { status: changes.bedStatus });
    },
    onSuccess: () => {
      refresh();
      toast.success('Etapa iniciada');
    },
    onError: (error) => toast.error(error.message || 'Não foi possível iniciar a etapa.'),
  });
  const reportMaintenance = useMutation({
    mutationFn: async ({ task, reason }) => {
      const changes = getMaintenanceWorkflowChanges(task, reason, user?.name || user?.email);
      await db.entities.CleaningTask.update(task.id, changes.taskUpdates);
      await db.entities.Bed.update(task.bed_id, { status: changes.bedStatus });
    },
    onSuccess: () => {
      refresh();
      toast.success('Manutenção acionada · tempo da hotelaria congelado');
    },
    onError: (error) => toast.error(error.message || 'Não foi possível acionar a manutenção.'),
  });
  const resumeMaintenance = useMutation({
    mutationFn: async (task) => {
      const changes = getResumeMaintenanceChanges(task);
      await db.entities.CleaningTask.update(task.id, changes.taskUpdates);
      await db.entities.Bed.update(task.bed_id, { status: changes.bedStatus });
    },
    onSuccess: () => {
      refresh();
      toast.success('Manutenção concluída · processo retomado com o tempo congelado');
    },
    onError: (error) => toast.error(error.message || 'Não foi possível retomar o processo.'),
  });
  const checkMaterials = useMutation({
    mutationFn: async ({ task, missing, total }) => {
      const items = missing.join(', ');
      await db.entities.MaterialCheck.create({
        bed_id: task.bed_id,
        bed_code: task.bed_code,
        unit_name: task.unit_name,
        task_id: task.id,
        checked_by: user?.name || user?.email,
        status: missing.length ? 'com_falta' : 'ok',
        total_items: total,
        missing_count: missing.length,
        missing_items: items,
      });
      await db.entities.Bed.update(task.bed_id, {
        missing_count: missing.length,
        missing_items: items,
      });
    },
    onSuccess: (_, values) => {
      setChecking(null);
      refresh();
      if (values.missing.length) toast.warning(`${values.missing.length} item(ns) faltando no leito ${values.task.bed_code}`);
      else toast.success('Conferência registrada');
    },
    onError: (error) => toast.error(error.message || 'Não foi possível registrar a conferência.'),
  });
  const setStatus = useMutation({
    mutationFn: ({ bed, status }) => db.entities.Bed.update(bed.id, { status }),
    onSuccess: refresh,
  });

  const countOf = (s) => counts?.rows?.find((r) => r.status === s)?.count || 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold text-slate-900">Leitos</h2>
        {isLeader && oracleStatus?.configured && (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className={oracleStatus.error ? 'text-red-700' : 'text-emerald-700'}>
              {oracleStatus.error
                ? `Oracle: ${oracleStatus.error}`
                : oracleStatus.succeededAt
                  ? `Oracle atualizado às ${new Date(oracleStatus.succeededAt).toLocaleTimeString()} · consulta automática a cada ${oracleStatus.pollIntervalMs / 1000}s`
                  : `Oracle configurado · consulta automática a cada ${oracleStatus.pollIntervalMs / 1000}s`}
            </span>
            <Button variant="outline" size="sm" disabled={syncOracle.isPending}
              onClick={() => syncOracle.mutate()}>
              {syncOracle.isPending ? 'Sincronizando...' : 'Sincronizar agora'}
            </Button>
          </div>
        )}
      </div>
      <OracleDischargePanel isLeader={isLeader} oracleConfigured={oracleStatus?.configured} />
      <MissingAlert />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(STATUS).map(([k, v]) => (
          <div key={k} className={`rounded-2xl border p-3 ${v.cls}`}>
            <p className="text-2xl font-semibold">{countOf(k)}</p>
            <p className="text-xs">{v.label}</p>
          </div>
        ))}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {[{ id: 'all', name: 'Todas' }, ...(units?.items || [])].map((u) => (
          <button key={u.id} onClick={() => setUnitId(u.id)} className={`px-4 h-10 rounded-full text-sm whitespace-nowrap border ${unitId === u.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600'}`}>{u.name}</button>
        ))}
      </div>
      {isLoading ? <p className="text-slate-500">Carregando...</p> : visibleBeds.length === 0 ? (
        (beds?.items || []).length > 0
          ? <p className="text-slate-500 text-sm">Nenhum leito pendente ou em processo de hotelaria.</p>
          : <p className="text-slate-500 text-sm">Nenhum leito disponível. Os leitos são importados automaticamente do MV.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleBeds.map((b) => (
            <BedCard key={b.id} bed={b} task={taskByBed[b.id]} onStart={setStarting}
              isLeader={isLeader}
              busy={advance.isPending || confirmMvRelease.isPending || startStage.isPending
                || reportMaintenance.isPending || resumeMaintenance.isPending}
              onAdvance={(task) => advance.mutate(task)}
              onConfirmMvRelease={(task) => confirmMvRelease.mutate(task)}
              onStartStage={(task, stage) => startStage.mutate({ task, stage })}
              onReportMaintenance={(task, reason) => reportMaintenance.mutate({ task, reason })}
              onResumeMaintenance={(task) => resumeMaintenance.mutate(task)}
              onCheckMaterials={(task) => setChecking(task)}
              checkingMaterials={checkMaterials.isPending}
              canHandleRouparia={false}
              onSetStatus={(bed, status) => setStatus.mutate({ bed, status })} />
          ))}
        </div>
      )}
      <StartDialog bed={starting}
        activeTasks={hygieneTasks}
        onClose={() => setStarting(null)} loading={start.isPending}
        onConfirm={(employee, type) => start.mutate({ bed: starting, employee, type })} />
      <MaterialCheckDialog task={checking} onClose={() => setChecking(null)} loading={checkMaterials.isPending}
        onConfirm={(missing, total) => checkMaterials.mutate({ task: checking, missing, total })} />
    </div>
  );
}