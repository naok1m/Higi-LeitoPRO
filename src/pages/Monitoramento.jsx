import { useQuery } from '@tanstack/react-query';
import { Activity, BedDouble, Clock3, Shirt, SprayCan } from 'lucide-react';
import { db } from '@/api/localClient';
import Timer from '@/components/beds/Timer';

const stageLabels = {
  higienizacao: 'Higienização',
  rouparia: 'Rouparia',
  revisao: 'Revisão',
  manutencao: 'Manutenção',
};

const metricStyles = [
  'border-amber-200 bg-amber-50 text-amber-900',
  'border-sky-200 bg-sky-50 text-sky-900',
  'border-indigo-200 bg-indigo-50 text-indigo-900',
  'border-violet-200 bg-violet-50 text-violet-900',
];

const stageFor = (task) => task.workflow_stage || 'higienizacao';

export default function Monitoramento() {
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

  const bedCounts = Object.fromEntries((counts?.rows || []).map((row) => [row.status, row.count]));
  const activeTasks = tasks?.items || [];
  const stageCounts = [
    { key: 'higienizacao', label: 'Higienização', icon: SprayCan, count: activeTasks.filter((task) => stageFor(task) === 'higienizacao').length },
    { key: 'rouparia', label: 'Rouparia', icon: Shirt, count: activeTasks.filter((task) => stageFor(task) === 'rouparia').length },
    { key: 'revisao', label: 'Revisão', icon: Activity, count: activeTasks.filter((task) => stageFor(task) === 'revisao').length },
    { key: 'manutencao', label: 'Manutenção', icon: Clock3, count: activeTasks.filter((task) => stageFor(task) === 'manutencao').length },
  ];
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

      {(countsError || tasksError) && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Não foi possível atualizar todos os indicadores: {countsErrorMessage?.message || tasksErrorMessage?.message}
        </p>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stageCounts.map(({ key, label, icon: Icon, count }, index) => (
          <article key={key} className={`rounded-2xl border p-4 ${metricStyles[index]}`}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{label}</p>
              <Icon className="h-5 w-5 opacity-70" />
            </div>
            <p className="mt-3 text-3xl font-semibold">{loadingTasks ? '—' : count}</p>
            <p className="mt-1 text-xs opacity-75">processo(s) ativo(s)</p>
          </article>
        ))}
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
            const idleStartedAt = task[`${stage}_idle_started_at`];
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
                    <p className="text-[10px] uppercase text-slate-500">{startedAt ? 'Tempo na etapa' : 'Aguardando início'}</p>
                    <Timer
                      startedAt={startedAt || idleStartedAt}
                      stoppedAt={task.maintenance_started_at}
                      initialSeconds={Number(task[`${stage}${startedAt ? '_duration_seconds' : '_idle_seconds'}`]) || 0}
                      className="font-mono font-semibold text-slate-900"
                    />
                  </div>
                </div>
                {stage === 'manutencao' && task.maintenance_reason && (
                  <p className="mt-3 text-xs text-amber-700">Motivo: {task.maintenance_reason}</p>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
