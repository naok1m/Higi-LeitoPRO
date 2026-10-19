import { db } from '@/api/localClient';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import StartDialog from '@/components/beds/StartDialog';
import Timer from '@/components/beds/Timer';
import WorkflowActions from '@/components/beds/WorkflowActions';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import {
  getAdvanceWorkflowChanges,
  getMaintenanceWorkflowChanges,
  getResumeMaintenanceChanges,
} from '@/lib/bedWorkflow';

const toIso = (d) => (/[zZ]|[+-]\d\d:?\d\d$/.test(d) ? d : `${d}Z`);

export default function Solicitacoes() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isLeader = ['admin', 'manager', 'user'].includes(user?.role);
  const [starting, setStarting] = useState(null);
  const { data: waiting, isLoading } = useQuery({
    queryKey: ['requests'],
    queryFn: () => db.entities.Bed.filter({ status: 'aguardando_limpeza' }, { sort: 'updated_date', limit: 200 }),
    refetchInterval: 10000,
  });
  const { data: active } = useQuery({
    queryKey: ['active-tasks', 'higienizacao'],
    queryFn: () => db.entities.CleaningTask.filter({ status: 'em_andamento' }, { limit: 200 }),
    refetchInterval: 10000,
  });
  const refresh = () => ['requests', 'active-tasks', 'beds', 'bed-counts', 'missing-items'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const hygieneTasks = (active?.items || []).filter((task) =>
    task.workflow_stage === 'higienizacao' || !task.workflow_stage);

  const start = useMutation({
    mutationFn: async ({ bed, employee, type }) => {
      const startedAt = new Date().toISOString();
      await db.entities.CleaningTask.create({
        bed_id: bed.id, bed_code: bed.code, unit_name: bed.unit_name, employee_id: employee.id,
        employee_name: employee.name, cleaning_type: type, status: 'em_andamento', workflow_stage: 'higienizacao',
        higienizacao_started_at: startedAt, started_at: startedAt, mv_sync_status: 'pendente',
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
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Limpeza</h2>
      <section className="space-y-3">
        <p className="text-sm font-medium text-amber-700">Aguardando ({waiting?.items?.length || 0})</p>
        {isLoading && <p className="text-slate-500">Carregando...</p>}
        {waiting && waiting.items.length === 0 && <p className="text-sm text-slate-500">Nenhuma solicitação no momento.</p>}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(waiting?.items || []).map((b) => (
            <div key={b.id} className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-3">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-2xl font-semibold text-amber-900">{b.code}</p>
                  <p className="text-xs text-amber-800/70">{b.unit_name}</p>
                  {b.oracle_request_missing && (
                    <p className="mt-1 text-xs text-amber-800">Solicitação de higienização sem código no MV.</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase text-amber-700">Aguardando há</p>
                  <Timer startedAt={toIso(b.updated_date)} className="font-semibold text-amber-900" />
                </div>
              </div>
              <Button className="w-full h-11 bg-amber-500 hover:bg-amber-600" onClick={() => setStarting(b)}>Iniciar limpeza</Button>
            </div>
          ))}
        </div>
      </section>
      <section className="space-y-3">
        <p className="text-sm font-medium text-sky-700">Em andamento ({hygieneTasks.length})</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {hygieneTasks.map((t) => (
            <div key={t.id} className="rounded-2xl border border-sky-200 bg-sky-50 p-4 space-y-2">
              <div className="flex justify-between">
                <p className="text-xl font-semibold text-sky-900">{t.bed_code} <span className="text-xs font-normal">{t.unit_name}</span></p>
                <Timer startedAt={t.higienizacao_started_at || t.started_at}
                  stoppedAt={t.maintenance_started_at}
                  initialSeconds={Number(t.higienizacao_duration_seconds) || 0}
                  className="text-xl font-semibold text-sky-900" />
              </div>
              <p className="text-xs text-sky-800">{t.employee_name}</p>
              <WorkflowActions task={t} isLeader={isLeader}
                busy={advance.isPending || reportMaintenance.isPending || resumeMaintenance.isPending}
                onAdvance={(task) => advance.mutate(task)}
                onReportMaintenance={(task, reason) => reportMaintenance.mutate({ task, reason })}
                onResumeMaintenance={(task) => resumeMaintenance.mutate(task)} />
            </div>
          ))}
        </div>
      </section>
      <StartDialog bed={starting} activeTasks={hygieneTasks} onClose={() => setStarting(null)} loading={start.isPending}
        onConfirm={(employee, type) => start.mutate({ bed: starting, employee, type })} />
    </div>
  );
}