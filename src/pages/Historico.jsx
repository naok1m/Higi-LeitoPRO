import { db } from '@/api/localClient';
import { useQuery } from '@tanstack/react-query';

import { formatDuration } from '@/components/beds/Timer';
import moment from 'moment';

export default function Historico() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['history'],
    queryFn: () => db.entities.CleaningTask.filter({ status: 'concluida' }, { sort: '-finished_at', limit: 50 }),
  });
  const { data: avg, isError: avgError, error: avgErrorMessage } = useQuery({
    queryKey: ['avg-duration'],
    queryFn: () => db.entities.CleaningTask.aggregate({ query: { status: 'concluida' }, avg: ['duration_seconds'] }),
  });
  const mean = avg?.rows?.[0]?.avg_duration_seconds;

  return (
    <div className="space-y-5">
      <h2 className="text-2xl font-semibold">Histórico de processos da hotelaria</h2>
      <div className="bg-white rounded-2xl border p-4 inline-block">
        <p className="text-xs text-slate-500">Tempo médio da hotelaria</p>
        {avgError
          ? <p role="alert" className="text-sm text-red-700">{avgErrorMessage.message}</p>
          : <p className="text-2xl font-semibold font-mono">{mean != null ? formatDuration(mean) : '--:--:--'}</p>}
      </div>
      {isLoading && <p className="text-slate-500">Carregando...</p>}
      {isError && <p role="alert" className="text-sm text-red-700">{error.message}</p>}
      <div className="space-y-2">
        {(data?.items || []).map((t) => (
          <div key={t.id} className="bg-white rounded-2xl border p-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">Leito {t.bed_code} <span className="text-slate-400 font-normal">· {t.unit_name}</span></p>
              <p className="text-xs text-slate-500">
                {t.employee_name} · {t.workflow_stage ? 'Higienização, rouparia e revisão' : t.cleaning_type}
                {' · '}{moment(t.finished_at).format('DD/MM HH:mm')}
                {t.reviewed_by ? ` · Revisado por ${t.reviewed_by}` : ''}
              </p>
              {t.workflow_stage && (
                <>
                  <p className="text-xs text-slate-600">
                    Higienização {Number.isFinite(t.higienizacao_duration_seconds) ? formatDuration(t.higienizacao_duration_seconds) : '—'}
                    {' · '}Rouparia {Number.isFinite(t.rouparia_duration_seconds) ? formatDuration(t.rouparia_duration_seconds) : '—'}
                    {' · '}Revisão {Number.isFinite(t.revisao_duration_seconds) ? formatDuration(t.revisao_duration_seconds) : '—'}
                    {t.rouparia_by ? ` · Rouparia por ${t.rouparia_by}` : ''}
                  </p>
                  <p className="text-xs text-amber-700">
                    Ocioso: higienização {Number.isFinite(t.higienizacao_idle_seconds) ? formatDuration(t.higienizacao_idle_seconds) : '—'}
                    {' · '}rouparia {Number.isFinite(t.rouparia_idle_seconds) ? formatDuration(t.rouparia_idle_seconds) : '—'}
                    {' · '}revisão {Number.isFinite(t.revisao_idle_seconds) ? formatDuration(t.revisao_idle_seconds) : '—'}
                    {' · '}total {Number.isFinite(t.idle_duration_seconds) ? formatDuration(t.idle_duration_seconds) : '—'}
                  </p>
                </>
              )}
              {t.maintenance_reason && (
                <p className="text-xs text-amber-700">Manutenção: {t.maintenance_reason}</p>
              )}
            </div>
            <div className="text-right">
              <p className="font-mono font-semibold">{formatDuration(t.duration_seconds)}</p>
              <p className="text-[10px] uppercase text-slate-400">MV: {t.mv_sync_status || 'pendente'}</p>
            </div>
          </div>
        ))}
        {data && data.items.length === 0 && <p className="text-sm text-slate-500">Nenhum processo concluído ainda.</p>}
      </div>
    </div>
  );
}