import { useQuery } from '@tanstack/react-query';
import { db } from '@/api/localClient';
import ReportTable from '@/components/reports/ReportTable';
import Timer from '@/components/beds/Timer';
import { formatDuration } from '@/components/beds/Timer';

export default function WaitingReport() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['waiting-report'],
    queryFn: () => db.entities.Bed.filter({ status: 'aguardando_limpeza' }, { sort: 'updated_date', limit: 1000 }),
  });
  const rows = data?.items || [];

  if (isError) return <p role="alert" className="text-sm text-red-700">{error.message}</p>;
  return (
    <ReportTable loading={isLoading} rows={rows} columns={[
      { label: 'Leito', render: (bed) => bed.code },
      { label: 'Unidade', render: (bed) => bed.unit_name || '—' },
      {
        label: 'Aguardando desde',
        render: (bed) => <Timer startedAt={bed.updated_date} />,
        exportValue: (bed) => formatDuration((Date.now() - Date.parse(bed.updated_date)) / 1000),
      },
    ]} empty="Nenhum leito aguardando limpeza." />
  );
}
