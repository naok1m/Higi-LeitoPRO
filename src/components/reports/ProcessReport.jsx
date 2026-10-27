import { useQuery } from '@tanstack/react-query';
import { db } from '@/api/localClient';
import { formatDuration } from '@/components/beds/Timer';
import ReportTable from '@/components/reports/ReportTable';
import TimeCompositionChart from '@/components/reports/TimeCompositionChart';
import { periodQuery } from '@/components/reports/useCleaningAgg';
import moment from 'moment';

const stageColumns = [
  ['higienizacao_duration_seconds', 'Higienização'],
  ['rouparia_duration_seconds', 'Rouparia'],
  ['revisao_duration_seconds', 'Revisão'],
];
const idleColumns = [
  ['higienizacao_idle_seconds', 'Ocioso pré-higienização'],
  ['rouparia_idle_seconds', 'Ocioso pré-rouparia'],
  ['revisao_idle_seconds', 'Ocioso pré-revisão'],
];

const showDuration = (value) => Number.isFinite(value) ? formatDuration(value) : '—';

const summaryFields = [
  'active_duration_seconds',
  'idle_duration_seconds',
  'duration_seconds',
  ...stageColumns.map(([field]) => field),
  ...idleColumns.map(([field]) => field),
];

const total = (summary, field) => Number(summary?.[`sum_${field}`]) || 0;

export default function ProcessReport({ period }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['process-report', period],
    queryFn: async () => {
      const query = periodQuery(period);
      const [details, summary, byUnit] = await Promise.all([
        db.entities.CleaningTask.filter(query, { sort: '-finished_at', limit: 1000 }),
        db.entities.CleaningTask.aggregate({ query, sum: summaryFields }),
        db.entities.CleaningTask.aggregate({ query, groupBy: 'unit_name', sum: summaryFields }),
      ]);
      return {
        rows: details.items || [],
        summary: summary.rows?.[0] || {},
        byUnit: byUnit.rows || [],
      };
    },
  });
  const rows = data?.rows || [];
  const operationSeconds = (summary) => {
    const active = total(summary, 'active_duration_seconds')
      || stageColumns.reduce((sum, [field]) => sum + total(summary, field), 0);
    return active || Math.max(0, total(summary, 'duration_seconds') - idleSeconds(summary));
  };
  const idleSeconds = (summary) => total(summary, 'idle_duration_seconds')
    || idleColumns.reduce((sum, [field]) => sum + total(summary, field), 0);
  const totalProcessDuration = operationSeconds(data?.summary);
  const totalIdleDuration = idleSeconds(data?.summary);
  const percent = (value, totalValue) => totalValue ? `${(value / totalValue * 100).toFixed(1)}%` : '0.0%';
  const average = (field) => {
    const durations = rows.map((task) => task[field]).filter(Number.isFinite);
    return durations.length
      ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
      : null;
  };

  if (isError) return <p role="alert" className="text-sm text-red-700">{error.message}</p>;
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Duração registrada separadamente em cada etapa. O tempo total inclui a espera desde a solicitação e exclui o período após o acionamento da manutenção.
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <div className="rounded-2xl border bg-white p-4">
          <p className="text-xs text-slate-500">Tempo total de operação</p>
          <p className="font-mono text-xl font-semibold">
            {isLoading ? '—' : showDuration(totalProcessDuration)}
          </p>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <p className="text-xs text-slate-500">Processos concluídos</p>
          <p className="text-xl font-semibold">{isLoading ? '—' : data?.summary?.count || 0}</p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs text-amber-800">Tempo total de ociosidade</p>
          <p className="font-mono text-xl font-semibold text-amber-950">
            {isLoading ? '—' : showDuration(totalIdleDuration)}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {[...stageColumns, ...idleColumns].map(([field, label]) => (
          <div key={field} className="rounded-2xl border bg-white p-4">
            <p className="text-xs text-slate-500">Média · {label.toLowerCase()}</p>
            <p className="font-mono text-xl font-semibold">{showDuration(average(field))}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <TimeCompositionChart
          title="Geral · operação e ociosidade"
          operationSeconds={totalProcessDuration}
          idleSeconds={totalIdleDuration}
        />
        {(data?.byUnit || []).map((unit) => (
          <TimeCompositionChart
            key={unit.unit_name || 'sem-unidade'}
            title={unit.unit_name || 'Unidade não informada'}
            operationSeconds={operationSeconds(unit)}
            idleSeconds={idleSeconds(unit)}
          />
        ))}
      </div>
      <ReportTable loading={isLoading} period={period} rows={rows} summaryRows={[
        ['Resumo dos tempos'],
        ['Escopo', 'Operação', '% do total', 'Ociosidade', '% do total'],
        ['Geral', showDuration(totalProcessDuration), percent(totalProcessDuration, totalProcessDuration + totalIdleDuration),
          showDuration(totalIdleDuration), percent(totalIdleDuration, totalProcessDuration + totalIdleDuration)],
        ...(data?.byUnit || []).map((unit) => {
          const operation = operationSeconds(unit);
          const idle = idleSeconds(unit);
          return [
            unit.unit_name || 'Unidade não informada',
            showDuration(operation),
            percent(operation, operation + idle),
            showDuration(idle),
            percent(idle, operation + idle),
          ];
        }),
      ]} columns={[
        { label: 'Leito', render: (task) => task.bed_code },
        { label: 'Unidade', render: (task) => task.unit_name || '—' },
        { label: 'Tipo de limpeza', render: (task) => task.cleaning_type || '—' },
        { label: 'Conclusão', render: (task) => task.completion_method === 'manual' ? 'Manual' : 'Fluxo normal' },
        { label: 'Motivo da conclusão manual', render: (task) => task.manual_completion_reason || '—' },
        { label: 'Concluído por', render: (task) => task.manual_completed_by || task.reviewed_by || '—' },
        { label: 'Resp. higienização', render: (task) => task.employee_name || '—' },
        { label: 'Resp. rouparia', render: (task) => task.rouparia_by || '—' },
        { label: 'Resp. revisão', render: (task) => task.reviewed_by || '—' },
        ...stageColumns.map(([field, label]) => ({
          label,
          right: true,
          render: (task) => showDuration(task[field]),
        })),
        {
          label: 'Total ativo',
          right: true,
          render: (task) => showDuration(task.active_duration_seconds),
        },
        ...idleColumns.map(([field, label]) => ({
          label,
          right: true,
          render: (task) => showDuration(task[field]),
        })),
        {
          label: 'Total ocioso',
          right: true,
          render: (task) => showDuration(task.idle_duration_seconds),
        },
        {
          label: 'Total hotelaria',
          right: true,
          render: (task) => showDuration(task.duration_seconds),
        },
        { label: 'Concluído', render: (task) => moment(task.finished_at).format('DD/MM/YY HH:mm') },
      ]} empty="Nenhum processo concluído no período." />
    </div>
  );
}
