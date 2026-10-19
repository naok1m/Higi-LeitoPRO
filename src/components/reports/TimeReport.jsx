import useCleaningAgg from './useCleaningAgg';
import ReportTable from './ReportTable';
import ReportChart from './ReportChart';
import { formatDuration } from '@/components/beds/Timer';

function Block({ title, groupBy, period, label, color, fmt = (v) => v }) {
  const { data, isLoading, isError, error } = useCleaningAgg(groupBy, period);
  const rows = data || [];
  if (isError) return <p role="alert" className="text-sm text-red-700">{error.message}</p>;
  return (
    <div className="space-y-3">
      <p className="font-medium">{title}</p>
      <ReportChart title="Tempo médio da hotelaria" color={color} format={formatDuration}
        rows={rows.map((r) => ({ name: fmt(r[groupBy]) || '—', value: Math.round(r.avg_duration_seconds || 0) }))} />
      <ReportTable loading={isLoading} period={period} rows={rows} columns={[
        { label, render: (r) => fmt(r[groupBy]) || '—' },
        { label: 'Processos', right: true, render: (r) => r.count },
        { label: 'Médio da hotelaria', right: true, render: (r) => formatDuration(r.avg_duration_seconds) },
        { label: 'Mínimo da hotelaria', right: true, render: (r) => formatDuration(r.min_duration_seconds) },
        { label: 'Máximo da hotelaria', right: true, render: (r) => formatDuration(r.max_duration_seconds) },
      ]} />
    </div>
  );
}

export default function TimeReport({ period }) {
  return (
    <div className="space-y-6">
      <Block title="Por tipo de limpeza" groupBy="cleaning_type" period={period} label="Tipo" color="#086986" fmt={(v) => (v ? v[0].toUpperCase() + v.slice(1) : v)} />
      <Block title="Por unidade" groupBy="unit_name" period={period} label="Unidade" color="#7c3aed" />
    </div>
  );
}