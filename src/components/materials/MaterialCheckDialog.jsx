import { db } from '@/api/localClient';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

export default function MaterialCheckDialog({ task, onClose, onConfirm, loading }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['materials', 'active'],
    queryFn: () => db.entities.Material.filter({ active: true }, { sort: 'name', limit: 200 }),
    enabled: !!task,
  });
  const [missing, setMissing] = useState([]);
  useEffect(() => { setMissing([]); }, [task?.id]);

  const items = data?.items || [];
  const toggle = (id) => setMissing((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  const names = items.filter((m) => missing.includes(m.id)).map((m) => m.name);

  return (
    <Dialog open={!!task} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Conferência de utensílios</DialogTitle>
          <DialogDescription>
            Leito {task?.bed_code} · {task?.unit_name} · {task?.employee_name}
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-slate-500">Carregando...</p>
        ) : isError ? (
          <p role="alert" className="text-sm text-red-700">{error.message}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum utensílio cadastrado. Peça ao gestor para cadastrá-lo na seção Utensílios.</p>
        ) : (
          <div className="max-h-80 overflow-y-auto divide-y">
            {items.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="text-sm">{m.name}</p>
                  {m.category && <p className="text-xs text-slate-500">{m.category}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs ${missing.includes(m.id) ? 'text-red-600 font-medium' : 'text-slate-400'}`}>
                    {missing.includes(m.id) ? 'Faltando' : 'Presente'}
                  </span>
                  <Switch checked={missing.includes(m.id)} onCheckedChange={() => toggle(m.id)} />
                </div>
              </div>
            ))}
          </div>
        )}
        {names.length > 0 && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">Faltando: {names.join(', ')}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={loading || isLoading || isError || items.length === 0}
            onClick={() => onConfirm(names, items.length)}>Salvar conferência</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}