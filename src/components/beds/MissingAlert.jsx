import { db } from '@/api/localClient';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export default function MissingAlert() {
  const qc = useQueryClient();
  const { data, isError, error } = useQuery({
    queryKey: ['missing-items'],
    queryFn: () => db.entities.Bed.filter({ missing_count: { $gt: 0 } }, { sort: '-updated_date', limit: 50 }),
    refetchInterval: 15000,
  });
  const resolve = useMutation({
    mutationFn: (bed) => db.entities.Bed.update(bed.id, { missing_count: 0, missing_items: '' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['missing-items'] }); qc.invalidateQueries({ queryKey: ['beds'] }); },
    onError: (requestError) => toast.error(requestError.message || 'Não foi possível atualizar o alerta.'),
  });

  const beds = data?.items || [];
  if (isError) {
    return <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      Não foi possível carregar os alertas de utensílios: {error.message}
    </p>;
  }
  if (!beds.length) return null;

  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 space-y-3">
      <p className="flex items-center gap-2 font-medium text-red-800">
        <AlertTriangle className="w-4 h-4" />Itens faltando ({beds.length})
      </p>
      <div className="space-y-2">
        {beds.map((b) => (
          <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white border border-red-100 px-3 py-2">
            <div>
              <p className="text-sm font-medium text-slate-900">{b.code} <span className="font-normal text-slate-500">{b.unit_name}</span></p>
              <p className="text-xs text-red-700">{b.missing_items}</p>
            </div>
            <Button variant="outline" className="h-9" disabled={resolve.isPending}
              onClick={() => resolve.mutate(b)}>Marcar como resolvido</Button>
          </div>
        ))}
      </div>
    </div>
  );
}