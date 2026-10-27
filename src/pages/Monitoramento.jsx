import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, BedDouble, CheckCircle2, Clock3 } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { db } from '@/api/localClient';
import Timer from '@/components/beds/Timer';
import IdleTimer from '@/components/beds/IdleTimer';
import MissingAlert from '@/components/beds/MissingAlert';
import LostFoundPanel from '@/components/monitoring/LostFoundPanel';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/lib/AuthContext';
import { Link } from 'react-router-dom';
import { formatDuration } from '@/components/beds/Timer';
import { toast } from 'sonner';

const stageLabels = {
  higienizacao: 'Higienização',
  rouparia: 'Rouparia',
  revisao: 'Revisão',
  manutencao: 'Manutenção',
};

const stageFor = (task) => task.workflow_stage || 'higienizacao';

export default function Monitoramento() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isLeader = ['admin', 'manager', 'user'].includes(user?.role);
  const [manualTask, setManualTask] = useState(null);
  const [manualReason, setManualReason] = useState('');
  const { data: counts, isLoading: loadingCounts, isError: countsError, error: countsErrorMessage } = useQuery({
    queryKey: ['bed-counts', 'monitoramento'],
    queryFn: () => db.entities.Bed.aggregate({ groupBy: 'status' }),
    refetchInterval: 10000,
  });
  const { data: tasks, isLoading: loadingTasks, isError: tasksError, error: tasksErrorMessage } = useQuery({
    queryKey: ['active-tasks', 'monitoramento'],
    queryFn: () => db.entities.CleaningTask.filter({ status: 'em_andamento' }, { sort: '-updated_date', limit: 300 }),
    refetchInterval: 10000,
  });
  const { data: idleLimit, isError: idleLimitError, error: idleLimitErrorMessage } = useQuery({
    queryKey: ['idle-limit'],
    queryFn: db.workflow.getIdleLimit,
  });
  const completeManually = useMutation({
    mutationFn: /** @type {import('@tanstack/react-query').MutationFunction<unknown, { task: Record<string, any>; reason: string }>} */ (
      ({ task, reason }) => db.workflow.completeManually(task.id, reason)
    ),
    onSuccess: () => {
      setManualTask(null);
      setManualReason('');
      ['active-tasks', 'bed-counts', 'process-report'].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
      toast.success('Processo concluído manualmente e registrado no histórico.');
    },
    onError: (error) => toast.error(error.message || 'Não foi possível concluir o processo manualmente.'),
  });

  const bedCounts = Object.fromEntries((counts?.rows || []).map((row) => [row.status, row.count]));
  const activeTasks = tasks?.items || [];
  const stageCounts = [
    { key: 'pre_higienizacao', label: 'Pré-higienização', count: Number(bedCounts.aguardando_limpeza || 0), color: '#f59e0b' },
    { key: 'higienizacao', label: 'Higienização', count: activeTasks.filter((task) => stageFor(task) === 'higienizacao').length, color: '#0f766e' },
    { key: 'pre_rouparia', label: 'Pré-rouparia', count: activeTasks.filter((task) => stageFor(task) === 'rouparia' && !task.rouparia_started_at).length, color: '#f59e0b' },
    { key: 'rouparia', label: 'Rouparia', count: activeTasks.filter((task) => stageFor(task) === 'rouparia' && task.rouparia_started_at).length, color: '#0f766e' },
    { key: 'pre_revisao', label: 'Pré-revisão', count: activeTasks.filter((task) => stageFor(task) === 'revisao' && !task.revisao_started_at).length, color: '#f59e0b' },
    { key: 'revisao', label: 'Revisão', count: activeTasks.filter((task) => stageFor(task) === 'revisao' && task.revisao_started_at).length, color: '#0f766e' },
  ];
  const chartData = stageCounts.map(({ key, label, count, color }) => ({ key, etapa: label, leitos: count, color }));
  const waitingCount = Number(bedCounts.aguardando_limpeza || 0)
    + Number(bedCounts.aguardando_rouparia || 0)
    + Number(bedCounts.aguardando_revisao || 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Painel de monitoramento</h2>
          <p className="mt-1 text-sm text-slate-500">Acompanhamento das filas e dos processos em andamento.</p>
        </div>
        <p className="text-xs text-slate-500">Atualização automática a cada 10 segundos</p>
      </header>

      {(countsError || tasksError || idleLimitError) && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Não foi possível atualizar todos os indicadores: {countsErrorMessage?.message || tasksErrorMessage?.message || idleLimitErrorMessage?.message}
        </p>
      )}

      <section className="rounded-xl border bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-slate-900">Leitos por etapa</h3>
            <p className="text-xs text-slate-500">Leitos aguardando início e etapas em andamento · atualização a cada 10 segundos</p>
            <div className="mt-2 flex gap-4 text-xs text-slate-600">
              <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-amber-500" />Aguardando início</span>
              <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-teal-700" />Em andamento</span>
            </div>
          </div>
          <Activity className="h-5 w-5 text-slate-500" />
        </div>
        {loadingTasks || loadingCounts ? <p className="py-8 text-center text-sm text-slate-500">Atualizando gráfico...</p> : (
          <div className="h-64 w-full">
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="etapa" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="leitos" name="Leitos" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry) => <Cell key={entry.key} fill={entry.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border bg-white p-4">
          <div className="flex items-center gap-2 text-sm text-slate-500"><BedDouble className="h-4 w-4" /> Leitos ocupados</div>
          <p className="mt-2 text-2xl font-semibold">{loadingCounts ? '—' : bedCounts.ocupado || 0}</p>
        </article>
        <article className="rounded-2xl border bg-white p-4">
          <div className="flex items-center gap-2 text-sm text-slate-500"><Clock3 className="h-4 w-4" /> Aguardando atendimento</div>
          <p className="mt-2 text-2xl font-semibold">{loadingCounts ? '—' : waitingCount}</p>
        </article>
        <article className="rounded-2xl border bg-white p-4">
          <div className="flex items-center gap-2 text-sm text-slate-500"><Activity className="h-4 w-4" /> Em processo</div>
          <p className="mt-2 text-2xl font-semibold">{loadingTasks ? '—' : activeTasks.length}</p>
        </article>
        <article className="rounded-2xl border bg-white p-4">
          <div className="flex items-center gap-2 text-sm text-slate-500"><BedDouble className="h-4 w-4" /> Livres / limpos</div>
          <p className="mt-2 text-2xl font-semibold">{loadingCounts ? '—' : bedCounts.livre || 0}</p>
        </article>
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-semibold text-slate-900">Processos ativos</h3>
        {loadingTasks && <p className="text-sm text-slate-500">Carregando processos...</p>}
        {!loadingTasks && !tasksError && activeTasks.length === 0 && (
          <p className="rounded-2xl border bg-white p-5 text-sm text-slate-500">Nenhum processo em andamento.</p>
        )}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {activeTasks.map((task) => {
            const stage = stageFor(task);
            const startedAt = stage === 'manutencao'
              ? task.maintenance_started_at
              : task[`${stage}_started_at`] || (stage === 'higienizacao' ? task.started_at : null);
            const idleStartedAt = task[`${stage}_idle_started_at`]
              || (stage === 'rouparia'
                ? task.higienizacao_finished_at
                : stage === 'revisao' ? task.rouparia_finished_at : null);
            const person = stage === 'rouparia'
              ? task.rouparia_employee_name
              : stage === 'revisao'
                ? task.reviewed_by
                : task.employee_name;
            return (
              <article key={task.id} className="rounded-2xl border bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xl font-semibold text-slate-900">Leito {task.bed_code}</p>
                    <p className="truncate text-xs text-slate-500">{task.unit_name || 'Unidade não informada'}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                    {stageLabels[stage] || stage}
                  </span>
                </div>
                <div className="mt-4 flex items-end justify-between gap-3">
                  <p className="truncate text-sm text-slate-600">{person || 'Responsável não informado'}</p>
                  <div className="text-right">
                    <p className="text-[10px] uppercase text-slate-500">Operação</p>
                    {startedAt ? (
                      <Timer startedAt={startedAt} stoppedAt={task.maintenance_started_at}
                        initialSeconds={Number(task[`${stage}_duration_seconds`]) || 0}
                        limitMinutes={idleLimit?.operationLimitMinutes ?? 360}
                        className="font-mono font-semibold text-slate-900" />
                    ) : (
                      <p className="font-mono font-semibold text-slate-900">{formatDuration(Number(task[`${stage}_duration_seconds`]) || 0)}</p>
                    )}
                    <p className="mt-1 text-[10px] uppercase text-slate-500">Ociosidade</p>
                    {!startedAt && idleStartedAt ? (
                      <IdleTimer startedAt={idleStartedAt} stoppedAt={task.maintenance_started_at}
                        initialSeconds={Number(task[`${stage}_idle_seconds`]) || 0}
                        limitMinutes={idleLimit?.idleLimitMinutes ?? 180}
                        className="font-mono font-semibold text-slate-900" />
                    ) : (
                      <p className="font-mono font-semibold text-slate-700">{formatDuration(Number(task[`${stage}_idle_seconds`]) || 0)}</p>
                    )}
                  </div>
                </div>
                {stage === 'manutencao' && task.maintenance_reason && (
                  <p className="mt-3 text-xs text-amber-700">Motivo: {task.maintenance_reason}</p>
                )}
                {isLeader && (
                  <Button variant="outline" className="mt-3 h-9 w-full" disabled={completeManually.isPending}
                    onClick={() => { setManualTask(task); setManualReason(''); }}>
                    <CheckCircle2 className="mr-2 h-4 w-4" />Concluir manualmente
                  </Button>
                )}
              </article>
            );
          })}
        </div>
      </section>
      {isLeader && (
        <section className="space-y-4">
          <LostFoundPanel />
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-slate-900">Utensílios</h3>
              <Link to="/estrutura" className="text-sm font-medium text-teal-800 underline underline-offset-2">Gerenciar utensílios</Link>
            </div>
            <MissingAlert />
          </div>
        </section>
      )}
      <Dialog open={Boolean(manualTask)} onOpenChange={(open) => !open && !completeManually.isPending && setManualTask(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Conclusão manual · Leito {manualTask?.bed_code}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">O processo será encerrado sem enviar atualização ao MV. O motivo ficará registrado no relatório.</p>
            <label className="grid gap-1 text-sm font-medium text-slate-700" htmlFor="manual-completion-reason">Motivo obrigatório</label>
            <textarea id="manual-completion-reason" className="min-h-24 w-full rounded-md border px-3 py-2 text-sm"
              maxLength={1000} required value={manualReason} onChange={(event) => setManualReason(event.target.value)}
              placeholder="Ex.: leito removido do MV" />
            <Button className="w-full" disabled={!manualReason.trim() || completeManually.isPending}
              onClick={() => completeManually.mutate({ task: manualTask, reason: manualReason.trim() })}>
              {completeManually.isPending ? 'Concluindo...' : 'Confirmar conclusão manual'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
