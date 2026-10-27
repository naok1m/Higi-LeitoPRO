import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { db } from '@/api/localClient';
import { useAuth } from '@/lib/AuthContext';
import { toast } from 'sonner';

const displayValue = (value) => value === null || value === undefined || value === '' ? '—' : String(value);

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('pt-BR');
};

/** @param {{ isLeader: boolean; oracleConfigured: boolean }} props */
export default function OracleDischargePanel({ isLeader, oracleConfigured }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedBedCode, setSelectedBedCode] = useState('');
  const [cleaningType, setCleaningType] = useState('');
  const [observation, setObservation] = useState('');
  const requesterName = user?.name?.trim() || user?.email || '';
  const observationMaxLength = Math.max(0, 1000 - `Solicitante: ${requesterName}\nMotivo: `.length);
  const enabled = isLeader && oracleConfigured;

  const { data: forecast, isLoading, isError, error } = useQuery({
    queryKey: ['oracle-discharge-forecast', user?.activeCompanyId],
    queryFn: db.oracle.dischargeForecast,
    enabled,
    refetchInterval: 2000,
  });
  const { data: occupiedBeds, isLoading: bedsLoading, isError: bedsError, error: bedsErrorMessage } = useQuery({
    queryKey: ['oracle-occupied-beds', user?.activeCompanyId],
    queryFn: db.oracle.occupiedBeds,
    enabled: enabled && dialogOpen,
    refetchInterval: 15000,
  });

  const beds = useMemo(() => (occupiedBeds?.rows || [])
    .filter((bed) => bed.CD_LEITO !== null && bed.CD_LEITO !== undefined)
    .filter((bed) => {
      const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR');
      return !normalizedSearch
        || String(bed.DS_LEITO || '').toLocaleLowerCase('pt-BR').includes(normalizedSearch)
        || String(bed.UNIDADE_INTERNACAO || '').toLocaleLowerCase('pt-BR').includes(normalizedSearch)
        || String(bed.CD_LEITO).includes(normalizedSearch);
    }), [occupiedBeds, search]);

  const requestCleaning = useMutation({
    mutationFn: () => db.oracle.requestAdHocCleaning({
      bedCode: selectedBedCode,
      cleaningType: cleaningType ? Number(cleaningType) : null,
      observation: observation.trim(),
    }),
    onSuccess: async (result) => {
      const requestCode = result.requestId == null ? '' : ` · solicitação ${result.requestId}`;
      toast.success(`Solicitação avulsa criada${requestCode}`);
      setDialogOpen(false);
      setSearch('');
      setSelectedBedCode('');
      setCleaningType('');
      setObservation('');
      queryClient.invalidateQueries({ queryKey: ['oracle-occupied-beds'] });
      try {
        await db.oracle.sync();
        ['beds', 'active-tasks', 'bed-counts', 'oracle-status'].forEach((key) => {
          queryClient.invalidateQueries({ queryKey: [key] });
        });
      } catch (syncError) {
        toast.error(`Solicitação criada, mas não foi possível atualizar a fila local: ${syncError.message}`);
      }
    },
    onError: (requestError) => toast.error(requestError.message || 'Não foi possível criar a solicitação avulsa.'),
  });

  if (!enabled) return null;

  return (
    <section className="space-y-3 rounded-xl border bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-900">Previsão de alta</h3>
          <p className="text-xs text-slate-500">Dados do MV · atualização a cada 2 segundos</p>
        </div>
        <button type="button" className="h-8 rounded-md border px-3 text-xs font-medium shadow-sm hover:bg-slate-50"
          onClick={() => setDialogOpen(true)}>
          Solicitação avulsa
        </button>
      </div>
      {isError && <p role="alert" className="text-sm text-red-700">{error.message}</p>}
      {isLoading ? (
        <p className="py-4 text-center text-sm text-slate-500">Consultando previsões no MV...</p>
      ) : !isError && (forecast?.rows || []).length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">Nenhuma previsão de alta encontrada.</p>
      ) : !isError && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Leito</th>
                <th className="px-3 py-2 font-medium">Alta médica</th>
                <th className="px-3 py-2 font-medium">Previsão</th>
                <th className="px-3 py-2 font-medium">Atendimento</th>
                <th className="px-3 py-2 font-medium">Situação da alta</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(forecast?.rows || []).map((row, index) => (
                <tr key={`${row.CD_LEITO}-${row.CD_ATENDIMENTO}-${index}`}>
                  <td className="px-3 py-2">
                    <span className="font-medium">{displayValue(row.DS_LEITO)}</span>
                    <span className="ml-2 text-xs text-slate-500">({displayValue(row.CD_LEITO)})</span>
                  </td>
                  <td className="px-3 py-2">{displayValue(row.SN_ALTA_MEDICA)}</td>
                  <td className="px-3 py-2">{formatDate(row.DH_ALTA_MEDICA)}</td>
                  <td className="px-3 py-2">{displayValue(row.CD_ATENDIMENTO)}</td>
                  <td className="px-3 py-2">{displayValue(row.SITUACAO_ALTA)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="presentation" onClick={(event) => {
            if (event.target === event.currentTarget && !requestCleaning.isPending) setDialogOpen(false);
          }}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
            role="dialog" aria-modal="true" aria-labelledby="oracle-ad-hoc-title">
            <h4 id="oracle-ad-hoc-title" className="mb-4 text-lg font-semibold">Solicitação avulsa de higienização</h4>
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                Leitos ocupados sem solicitação avulsa aberta, conforme consulta direta ao MV. A observação enviada inclui automaticamente o solicitante.
              </p>
              <label className="grid gap-1 text-sm font-medium text-slate-700" htmlFor="oracle-bed-search">
                Pesquisar leito, unidade ou código MV
              </label>
              <input id="oracle-bed-search" value={search} onChange={(event) => setSearch(event.target.value)}
                className="h-9 w-full rounded-md border bg-transparent px-3 text-sm" placeholder="Nome do leito ou código MV"
                disabled={requestCleaning.isPending} />
              {bedsError && <p role="alert" className="text-sm text-red-700">{bedsErrorMessage.message}</p>}
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-1">
                {bedsLoading ? (
                  <p className="p-3 text-sm text-slate-500">Consultando leitos ocupados no MV...</p>
                ) : beds.length ? beds.map((bed) => (
                  <button key={bed.CD_LEITO} type="button" aria-pressed={selectedBedCode === String(bed.CD_LEITO)}
                    className={`w-full rounded px-3 py-2 text-left text-sm ${selectedBedCode === String(bed.CD_LEITO) ? 'bg-teal-100 text-teal-950' : 'hover:bg-slate-100'}`}
                    onClick={() => setSelectedBedCode(String(bed.CD_LEITO))} disabled={requestCleaning.isPending}>
                    <span className="font-medium">{bed.DS_LEITO || bed.CD_LEITO}</span>
                    <span className="ml-2 text-slate-500">· MV {bed.CD_LEITO} · {bed.UNIDADE_INTERNACAO || bed.DS_ENFERMARIA || bed.SETOR || 'Unidade não informada'} · {bed.SITUACAO_LEITO}</span>
                  </button>
                )) : (
                  <p className="p-3 text-sm text-slate-500">
                    Nenhum leito ocupado e disponível para solicitação avulsa corresponde à pesquisa.
                  </p>
                )}
              </div>
              <label className="grid gap-1 text-sm font-medium text-slate-700" htmlFor="oracle-cleaning-type">
                Tipo de limpeza
              </label>
              <select id="oracle-cleaning-type" value={cleaningType} onChange={(event) => setCleaningType(event.target.value)}
                className="h-9 w-full rounded-md border bg-transparent px-3 text-sm" disabled={requestCleaning.isPending}>
                <option value="">Não informado</option>
                <option value="1">Terminal</option>
                <option value="3">Concorrente</option>
              </select>
              <label className="grid gap-1 text-sm font-medium text-slate-700" htmlFor="oracle-cleaning-observation">
                Motivo da solicitação (opcional)
              </label>
              <textarea id="oracle-cleaning-observation" value={observation} maxLength={observationMaxLength}
                onChange={(event) => setObservation(event.target.value)} disabled={requestCleaning.isPending}
                className="min-h-20 w-full rounded-md border px-3 py-2 text-sm"
                placeholder="Informe o motivo para o MV" />
              <button type="button" className="h-9 w-full rounded-md bg-teal-800 px-4 text-sm font-medium text-white hover:bg-teal-900 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!selectedBedCode || bedsError || requestCleaning.isPending}
                onClick={() => requestCleaning.mutate()}>
                {requestCleaning.isPending ? 'Enviando ao MV...' : 'Criar solicitação no MV'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
