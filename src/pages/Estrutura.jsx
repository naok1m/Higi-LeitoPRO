import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/api/localClient';
import { useAuth } from '@/lib/AuthContext';
import MaterialsSection from '@/components/materials/MaterialsSection';

export default function Estrutura() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const canDeleteBeds = isAdmin;
  const [confirmPurge, setConfirmPurge] = useState(false);
  const { data: units } = useQuery({
    queryKey: ['units'],
    queryFn: () => db.entities.Unit.filter({}, { sort: 'name', limit: 200 }),
    enabled: isAdmin,
  });
  const { data: beds } = useQuery({
    queryKey: ['structure-beds'],
    queryFn: () => db.entities.Bed.filter({}, { sort: 'code', limit: 1000 }),
    enabled: isAdmin,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['units'] });
    queryClient.invalidateQueries({ queryKey: ['structure-beds'] });
    queryClient.invalidateQueries({ queryKey: ['beds'] });
    queryClient.invalidateQueries({ queryKey: ['bed-counts'] });
  };

  const removeUnit = useMutation({
    mutationFn: async (unit) => {
      const linkedBeds = await db.entities.Bed.filter({ unit_id: unit.id });
      if (linkedBeds.items.length) throw new Error('Remova os leitos desta unidade antes de excluí-la.');
      return db.entities.Unit.delete(unit.id);
    },
    onSuccess: () => {
      refresh();
      toast.success('Unidade removida.');
    },
    onError: (error) => toast.error(error.message || 'Não foi possível remover a unidade.'),
  });

  const removeBed = useMutation({
    mutationFn: async (bed) => {
      const tasks = await db.entities.CleaningTask.filter({ bed_id: bed.id }, { limit: 1 });
      if (tasks.items.length) throw new Error('Este leito possui histórico de limpezas e não pode ser removido.');
      return db.entities.Bed.delete(bed.id);
    },
    onSuccess: () => {
      refresh();
      toast.success('Leito removido.');
    },
    onError: (error) => toast.error(error.message || 'Não foi possível remover o leito.'),
  });

  const purgeManual = useMutation({
    mutationFn: () => db.structure.purgeManual(),
    onSuccess: (result) => {
      setConfirmPurge(false);
      refresh();
      toast.success(
        `${result.deletedBeds} leito(s) e ${result.deletedUnits} posto(s) manual(is) excluído(s). `
        + `${result.preservedHistoryCount} processo(s) histórico(s) preservado(s).`,
      );
    },
    onError: (error) => toast.error(error.message || 'Não foi possível excluir os cadastros manuais.'),
  });

  const unitItems = units?.items || [];
  const bedItems = beds?.items || [];
  const manualBedCount = bedItems.filter((bed) => bed.oracle_source !== 'oracle').length;
  const manualUnitCount = unitItems.filter((unit) => unit.oracle_source !== 'oracle').length;
  const bedStatuses = [
    ['ocupado', 'Ocupado'],
    ['aguardando_limpeza', 'Aguardando limpeza'],
    ['em_limpeza', 'Em higienização'],
    ['aguardando_rouparia', 'Aguardando rouparia'],
    ['em_rouparia', 'Em rouparia'],
    ['aguardando_revisao', 'Aguardando revisão'],
    ['em_revisao', 'Em revisão'],
    ['aguardando_manutencao', 'Aguardando manutenção'],
    ['livre', 'Livre / Limpo'],
  ];

  return (
    <div className="space-y-8">
      {isAdmin && <h2 className="text-2xl font-semibold">Unidades e leitos</h2>}

      {isAdmin && (manualBedCount > 0 || manualUnitCount > 0) && (
        <section className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-900">
            {manualBedCount} leito(s) e {manualUnitCount} posto(s) cadastrado(s) manualmente.
            A exclusão remove esses cadastros, mesmo quando têm histórico; os processos históricos serão preservados.
          </p>
          {!confirmPurge ? (
            <button type="button" onClick={() => setConfirmPurge(true)}
              className="rounded-lg bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800">
              Excluir cadastros manuais
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-red-900">Confirma a exclusão permanente?</span>
              <button type="button" disabled={purgeManual.isPending}
                onClick={() => purgeManual.mutate()}
                className="rounded-lg bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50">
                {purgeManual.isPending ? 'Excluindo...' : 'Confirmar exclusão'}
              </button>
              <button type="button" disabled={purgeManual.isPending}
                onClick={() => setConfirmPurge(false)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                Cancelar
              </button>
            </div>
          )}
        </section>
      )}

      {isAdmin && <section className="space-y-3">
        <h3 className="text-lg font-medium">Unidades</h3>
        <p className="text-sm text-slate-500">Unidades e postos são importados automaticamente do MV.</p>
        <div className="space-y-2">
          {unitItems.map((unit) => (
            <div key={unit.id} className="bg-white rounded-2xl border p-4 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium">{unit.name}</p>
                {unit.code && <p className="text-xs text-slate-500">{unit.code}</p>}
              </div>
              <span className="text-xs text-slate-500">{bedItems.filter((bed) => bed.unit_id === unit.id).length} leito(s)</span>
              {canDeleteBeds && unit.oracle_source !== 'oracle' && (
                <button type="button" aria-label={`Remover unidade ${unit.name}`} onClick={() => removeUnit.mutate(unit)}
                  className="text-slate-400 hover:text-red-500 p-2"><Trash2 className="w-4 h-4" /></button>
              )}
            </div>
          ))}
          {units && unitItems.length === 0 && <p className="text-sm text-slate-500">Nenhuma unidade cadastrada.</p>}
        </div>
      </section>}

      {isAdmin && <section className="space-y-3">
        <h3 className="text-lg font-medium">Leitos</h3>
        <div className="bg-white rounded-2xl border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr><th className="text-left px-4 py-3">Leito</th><th className="text-left px-4 py-3">Unidade</th><th className="text-left px-4 py-3">Situação</th><th className="px-4 py-3" /></tr>
            </thead>
            <tbody>
              {bedItems.map((bed) => (
                <tr key={bed.id} className="border-t">
                  <td className="px-4 py-3 font-medium">{bed.code}</td>
                  <td className="px-4 py-3">{bed.unit_name}</td>
                  <td className="px-4 py-3">{bedStatuses.find(([value]) => value === bed.status)?.[1] || bed.status}</td>
                  <td className="px-4 py-3 text-right">
                    {canDeleteBeds && bed.oracle_source !== 'oracle' && (
                      <button type="button" aria-label={`Remover leito ${bed.code}`}
                        disabled={removeBed.isPending}
                        onClick={() => removeBed.mutate(bed)}
                        className="text-slate-400 hover:text-red-500 disabled:opacity-50">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {beds && bedItems.length === 0 && <tr><td colSpan="4" className="px-4 py-4 text-sm text-slate-500">Nenhum leito cadastrado.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>}

      <MaterialsSection />
    </div>
  );
}
