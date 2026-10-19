import useCleaningAgg from './useCleaningAgg';
import ReportTable from './ReportTable';
import ReportChart from './ReportChart';
import { formatDuration } from '@/components/beds/Timer';

export default function PerformanceReport({ period, mode }) {
  const { data, isLoading, isError, error } = useCleaningAgg('employee_name', period);
  const best = mode === 'best';
  const rows = [...(data || [])].sort((a, b) => {
    const countDifference = best ? b.count - a.count : a.count - b.count;
    if (countDifference) return countDifference;

    const aHasDuration = Number.isFinite(a.avg_duration_seconds);
    const bHasDuration = Number.isFinite(b.avg_duration_seconds);
    if (aHasDuration !== bHasDuration) return aHasDuration ? -1 : 1;

    if (aHasDuration && a.avg_duration_seconds !== b.avg_duration_seconds) {
      return best
        ? a.avg_duration_seconds - b.avg_duration_seconds
        : b.avg_duration_seconds - a.avg_duration_seconds;
    }

    return (a.employee_name || '').localeCompare(b.employee_name || '');
  });
  if (isError) return <p role="alert" className="text-sm text-red-700">{error.message}</p>;
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        {best
          ? 'Ranking pela maior quantidade de limpezas; o menor tempo médio desempata.'
          : 'Ranking pela menor quantidade de limpezas; o maior tempo médio desempata.'}
      </p>
      <ReportChart title={best ? 'Melhor desempenho (limpezas)' : 'Pior desempenho (limpezas)'} horizontal
        color={best ? '#059669' : '#dc2626'}
        rows={rows.map((r) => ({ name: r.employee_name || '—', value: r.count }))} />
      <ReportTable loading={isLoading} period={period} rows={rows} columns={[
        { label: '#', render: (_, i) => i + 1 },
        { label: 'Colaborador', render: (r) => r.employee_name || '—' },
        { label: 'Limpezas', right: true, render: (r) => r.count },
        { label: 'Tempo médio', right: true, render: (r) => formatDuration(r.avg_duration_seconds) },
      ]} />
    </div>
  );
}