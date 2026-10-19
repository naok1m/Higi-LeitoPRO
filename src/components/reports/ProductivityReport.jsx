import useCleaningAgg from './useCleaningAgg';
import ReportTable from './ReportTable';
import ReportChart from './ReportChart';
import { formatDuration } from '@/components/beds/Timer';

export default function ProductivityReport({ period }) {
  const { data, isLoading, isError, error } = useCleaningAgg('employee_name', period);
  const rows = data || [];
  const total = rows.reduce((a, r) => a + r.count, 0);
  if (isError) return <p role="alert" className="text-sm text-red-700">{error.message}</p>;
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">Total de processos concluídos: <b className="text-slate-900">{total}</b></p>
      <ReportChart title="Processos concluídos por colaborador" color="#086986" rows={rows.map((r) => ({ name: r.employee_name || '—', value: r.count }))} />
      <ReportChart title="Tempo médio da hotelaria por colaborador" color="#0284c7" horizontal format={formatDuration}
        rows={rows.map((r) => ({ name: r.employee_name || '—', value: Math.round(r.avg_duration_seconds || 0) }))} />
      <ReportTable loading={isLoading} period={period} rows={rows} columns={[
        { label: 'Colaborador', render: (r) => r.employee_name || '—' },
        { label: 'Processos', right: true, render: (r) => r.count },
        { label: 'Tempo hotelaria', right: true, render: (r) => formatDuration(r.sum_duration_seconds) },
        { label: 'Média hotelaria', right: true, render: (r) => formatDuration(r.avg_duration_seconds) },
      ]} />
    </div>
  );
}