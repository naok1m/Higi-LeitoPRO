import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { db } from '@/api/localClient';

const PRESET_INTERVAL = 20;
const MAX_IDLE_MINUTES = 180;
const MAX_OPERATION_MINUTES = 720;

const toManualTime = (minutes) => ({
  hours: Math.floor(minutes / 60),
  minutes: minutes % 60,
});

export default function IdleLimitSettings() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['idle-limit'],
    queryFn: db.workflow.getIdleLimit,
  });
  const [selection, setSelection] = useState('180');
  const [manualTime, setManualTime] = useState({ hours: 3, minutes: 0 });
  const [operationTime, setOperationTime] = useState({ hours: 6, minutes: 0 });
  const updateLimit = useMutation({
    mutationFn: /** @type {import('@tanstack/react-query').MutationFunction<unknown, { idleLimitMinutes: number; operationLimitMinutes: number }>} */ (
      ({ idleLimitMinutes, operationLimitMinutes }) =>
        db.workflow.updateIdleLimit(idleLimitMinutes, operationLimitMinutes)
    ),
    onSuccess: (result) => {
      queryClient.setQueryData(['idle-limit'], result);
      toast.success('Limite de ociosidade atualizado.');
    },
    onError: (saveError) => toast.error(saveError.message || 'Não foi possível salvar o limite de ociosidade.'),
  });

  useEffect(() => {
    if (!data) return;
    const minutes = Number(data.idleLimitMinutes);
    setSelection(minutes % PRESET_INTERVAL === 0 ? String(minutes) : 'manual');
    setManualTime(toManualTime(minutes));
    setOperationTime(toManualTime(Number(data.operationLimitMinutes) || 360));
  }, [data]);

  const manualMinutes = Number(manualTime.hours) * 60 + Number(manualTime.minutes);
  const selectedMinutes = selection === 'manual' ? manualMinutes : Number(selection);
  const operationMinutes = Number(operationTime.hours) * 60 + Number(operationTime.minutes);
  const validLimit = Number.isInteger(selectedMinutes)
    && selectedMinutes >= 1
    && selectedMinutes <= MAX_IDLE_MINUTES;
  const validOperationLimit = Number.isInteger(operationMinutes)
    && operationMinutes >= 1
    && operationMinutes <= MAX_OPERATION_MINUTES;

  return (
    <section className="space-y-3 rounded-2xl border bg-white p-4">
      <div>
        <h3 className="font-semibold text-slate-900">Limite de ociosidade</h3>
        <p className="mt-1 text-sm text-slate-500">
          Gestores e administradores podem configurar o aviso. A operação continua disponível após o limite.
        </p>
      </div>
      {isLoading && <p className="text-sm text-slate-500">Carregando configuração...</p>}
      {isError && <p role="alert" className="text-sm text-red-700">{error.message}</p>}
      {!isLoading && !isError && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid min-w-52 gap-1 text-sm text-slate-600">
            Tempo máximo de ociosidade
            <select
              value={selection}
              onChange={(event) => setSelection(event.target.value)}
              className="h-10 rounded-md border bg-white px-3 text-slate-900"
            >
              {Array.from({ length: MAX_IDLE_MINUTES / PRESET_INTERVAL }, (_, index) => {
                const minutes = (index + 1) * PRESET_INTERVAL;
                return <option key={minutes} value={minutes}>{minutes} minutos</option>;
              })}
              <option value="manual">Personalizar horas/minutos</option>
            </select>
          </label>
          {selection === 'manual' && (
            <div className="flex items-end gap-2">
              <label className="grid w-24 gap-1 text-sm text-slate-600">
                Horas
                <input type="number" min="0" max="3" value={manualTime.hours}
                  className="h-10 w-full rounded-md border bg-white px-3 text-slate-900"
                  onChange={(event) => setManualTime((previous) => ({ ...previous, hours: Number(event.target.value) }))} />
              </label>
              <label className="grid w-24 gap-1 text-sm text-slate-600">
                Minutos
                <input type="number" min="0" max="59" value={manualTime.minutes}
                  className="h-10 w-full rounded-md border bg-white px-3 text-slate-900"
                  onChange={(event) => setManualTime((previous) => ({ ...previous, minutes: Number(event.target.value) }))} />
              </label>
            </div>
          )}
          <div className="flex items-end gap-2">
            <label className="grid w-24 gap-1 text-sm text-slate-600">
              Operação · horas
              <input type="number" min="0" max="12" value={operationTime.hours}
                className="h-10 w-full rounded-md border bg-white px-3 text-slate-900"
                onChange={(event) => setOperationTime((previous) => ({ ...previous, hours: Number(event.target.value) }))} />
            </label>
            <label className="grid w-24 gap-1 text-sm text-slate-600">
              Minutos
              <input type="number" min="0" max="59" value={operationTime.minutes}
                className="h-10 w-full rounded-md border bg-white px-3 text-slate-900"
                onChange={(event) => setOperationTime((previous) => ({ ...previous, minutes: Number(event.target.value) }))} />
            </label>
          </div>
          <button type="button"
            className="inline-flex h-10 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800 disabled:pointer-events-none disabled:opacity-50"
            disabled={!validLimit || !validOperationLimit || updateLimit.isPending
              || (selectedMinutes === data?.idleLimitMinutes && operationMinutes === data?.operationLimitMinutes)}
            onClick={() => updateLimit.mutate({ idleLimitMinutes: selectedMinutes, operationLimitMinutes: operationMinutes })}>
            {updateLimit.isPending ? 'Salvando...' : 'Salvar limite'}
          </button>
          {!validLimit && (
            <p role="alert" className="w-full text-sm text-red-700">
              Informe um tempo entre 1 minuto e 3 horas.
            </p>
          )}
          {!validOperationLimit && (
            <p role="alert" className="w-full text-sm text-red-700">
              O tempo de operação deve estar entre 1 minuto e 12 horas.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
