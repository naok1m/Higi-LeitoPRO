import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { db } from '@/api/localClient';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import EmployeeRegistrationField from '@/components/team/EmployeeRegistrationField';
import WorkflowActions from '@/components/beds/WorkflowActions';
import Timer from '@/components/beds/Timer';
import {
  getAdvanceWorkflowChanges,
  getMaintenanceWorkflowChanges,
  getStartStageChanges,
} from '@/lib/bedWorkflow';
import { useAuth } from '@/lib/AuthContext';

export default function Rouparia() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [startingTask, setStartingTask] = useState(null);
  const [startingEmployee, setStartingEmployee] = useState(null);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['linen-tasks'],
    queryFn: () => db.entities.CleaningTask.filter(
      { status: 'em_andamento', workflow_stage: 'rouparia' },
      { sort: 'rouparia_started_at', limit: 300 },
    ),
    refetchInterval: 10000,
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['linen-tasks'] });
    queryClient.invalidateQueries({ queryKey: ['active-tasks'] });
    queryClient.invalidateQueries({ queryKey: ['beds'] });
    queryClient.invalidateQueries({ queryKey: ['bed-counts'] });
  };
  const advance = useMutation({
    mutationFn: async (task) => {
      const changes = getAdvanceWorkflowChanges(task, '');
      await db.entities.CleaningTask.update(task.id, {
        ...changes.taskUpdates,
        rouparia_by: user?.email,
      });
      await db.entities.Bed.update(task.bed_id, { status: changes.bedStatus });
    },
    onSuccess: () => {
      refresh();
      toast.success('Rouparia concluída · enviado para revisão');
    },
    onError: (requestError) => toast.error(requestError.message || 'Não foi possível concluir a rouparia.'),
  });
  const startStage = useMutation({
    mutationFn: async ({ task, employee }) => {
      const changes = getStartStageChanges(task, 'rouparia');
      await db.entities.CleaningTask.update(task.id, {
        ...changes.taskUpdates,
        rouparia_employee_id: employee.id,
      });
      await db.entities.Bed.update(task.bed_id, { status: changes.bedStatus });
    },
    onSuccess: () => {
      setStartingTask(null);
      setStartingEmployee(null);
      refresh();
      toast.success('Rouparia iniciada');
    },
    onError: (requestError) => toast.error(requestError.message || 'Não foi possível iniciar a rouparia.'),
  });
  const reportMaintenance = useMutation({
    mutationFn: async ({ task, reason }) => {
      const changes = getMaintenanceWorkflowChanges(task, reason, user?.email);
      await db.entities.CleaningTask.update(task.id, changes.taskUpdates);
      await db.entities.Bed.update(task.bed_id, { status: changes.bedStatus });
    },
    onSuccess: () => {
      refresh();
      toast.success('Manutenção acionada · tempo da hotelaria congelado');
    },
    onError: (requestError) => toast.error(requestError.message || 'Não foi possível acionar a manutenção.'),
  });

  const tasks = data?.items || [];
  const waiting = tasks.filter((task) => !task.rouparia_started_at);
  const inProgress = tasks.filter((task) => task.rouparia_started_at);
  const busyEmployeeIds = useMemo(
    () => tasks.map((task) => task.rouparia_employee_id).filter(Boolean),
    [tasks],
  );
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900">Rouparia</h2>
        <p className="mt-1 text-sm text-slate-500">
          Leitos enviados após a higienização para troca das roupas de cama e demais processos da rouparia.
        </p>
      </div>
      {isLoading && <p className="text-sm text-slate-500">Carregando leitos...</p>}
      {isError && <p role="alert" className="text-sm text-red-700">{error.message}</p>}
      {!isLoading && !isError && tasks.length === 0 && (
        <p className="rounded-2xl border bg-white p-5 text-sm text-slate-500">
          Nenhum leito está aguardando atendimento da rouparia.
        </p>
      )}
      <section className="space-y-3">
        <h3 className="font-medium text-indigo-800">Aguardando início ({waiting.length})</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {waiting.map((task) => (
          <article key={task.id} className="space-y-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-2xl font-semibold text-indigo-950">{task.bed_code}</p>
                <p className="text-xs text-indigo-800/70">{task.unit_name}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase text-indigo-700">Ocioso antes da rouparia</p>
                <Timer startedAt={task.rouparia_idle_started_at || task.higienizacao_finished_at}
                  stoppedAt={task.maintenance_started_at}
                  initialSeconds={Number(task.rouparia_idle_seconds) || 0}
                  className="font-semibold text-indigo-950" />
              </div>
            </div>
            <WorkflowActions task={task} isLeader={false}
              busy={startStage.isPending || reportMaintenance.isPending}
              onStartStage={() => { setStartingEmployee(null); setStartingTask(task); }}
              onReportMaintenance={(currentTask, reason) => reportMaintenance.mutate({ task: currentTask, reason })}
              onResumeMaintenance={() => {}} />
          </article>
          ))}
        </div>
      </section>
      <section className="space-y-3">
        <h3 className="font-medium text-sky-800">Em andamento ({inProgress.length})</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {inProgress.map((task) => (
            <article key={task.id} className="space-y-3 rounded-2xl border border-sky-200 bg-sky-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-2xl font-semibold text-sky-950">{task.bed_code}</p>
                  <p className="text-xs text-sky-800/70">{task.unit_name}</p>
                      {task.rouparia_employee_name && (
                        <p className="text-xs text-sky-800">Responsável: {task.rouparia_employee_name}</p>
                      )}
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase text-sky-700">Tempo da rouparia</p>
                  <Timer startedAt={task.rouparia_started_at}
                    stoppedAt={task.maintenance_started_at}
                    initialSeconds={Number(task.rouparia_duration_seconds) || 0}
                    className="font-semibold text-sky-950" />
                </div>
              </div>
              <WorkflowActions task={task} isLeader={false}
                busy={advance.isPending || reportMaintenance.isPending}
                onAdvance={(currentTask) => advance.mutate(currentTask)}
                onReportMaintenance={(currentTask, reason) => reportMaintenance.mutate({ task: currentTask, reason })}
                onResumeMaintenance={() => {}} />
            </article>
          ))}
        </div>
      </section>
      <Dialog open={!!startingTask} onOpenChange={(open) => !open && !startStage.isPending && setStartingTask(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Iniciar rouparia · Leito {startingTask?.bed_code}</DialogTitle>
          </DialogHeader>
          <EmployeeRegistrationField
            key={startingTask?.id || 'no-task'}
            employeeFunction="rouparia"
            busyEmployeeIds={busyEmployeeIds}
            onEmployeeChange={setStartingEmployee}
          />
          <Button type="button" className="w-full" disabled={startStage.isPending || !startingEmployee}
            onClick={() => startingTask && startStage.mutate({ task: startingTask, employee: startingEmployee })}>
            {startStage.isPending ? 'Iniciando...' : 'Iniciar cronômetro'}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
