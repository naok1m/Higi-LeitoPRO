import { db } from '@/api/localClient';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Trash2 } from 'lucide-react';

export default function MaterialsSection() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [qty, setQty] = useState('1');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['materials'],
    queryFn: () => db.entities.Material.filter({}, { sort: 'name', limit: 200 }),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['materials'] });

  const add = useMutation({
    mutationFn: () => db.entities.Material.create({ name, category, expected_quantity: Number(qty) || 1, active: true }),
    onSuccess: () => { setName(''); setCategory(''); setQty('1'); refresh(); toast.success('Utensílio cadastrado.'); },
    onError: (requestError) => toast.error(requestError.message || 'Não foi possível cadastrar o utensílio.'),
  });
  const toggle = useMutation({
    mutationFn: (m) => db.entities.Material.update(m.id, { active: !m.active }),
    onSuccess: refresh,
    onError: (requestError) => toast.error(requestError.message || 'Não foi possível alterar o utensílio.'),
  });
  const del = useMutation({
    mutationFn: (id) => db.entities.Material.delete(id),
    onSuccess: refresh,
    onError: (requestError) => toast.error(requestError.message || 'Não foi possível remover o utensílio.'),
  });

  const items = data?.items || [];

  return (
    <div className="space-y-3">
      <h2 className="text-2xl font-semibold">Utensílios e materiais</h2>
      <div className="bg-white rounded-2xl border p-4 grid sm:grid-cols-[1fr_1fr_120px_auto] gap-2">
        <Input className="h-11" placeholder="Item (ex: Controle remoto)" value={name} onChange={(e) => setName(e.target.value)} />
        <Input className="h-11" placeholder="Categoria (opcional)" value={category} onChange={(e) => setCategory(e.target.value)} />
        <Input className="h-11" type="number" min="1" placeholder="Qtd padrão" value={qty} onChange={(e) => setQty(e.target.value)} />
        <Button className="h-11 bg-primary hover:bg-primary/90" disabled={!name} onClick={() => add.mutate()}>Adicionar</Button>
      </div>
      {isLoading ? (
        <p className="text-slate-500 text-sm">Carregando...</p>
      ) : isError ? (
        <p role="alert" className="text-sm text-red-700">{error.message}</p>
      ) : items.length === 0 ? (
        <p className="text-slate-500 text-sm">Nenhum material cadastrado.</p>
      ) : (
        <div className="bg-white rounded-2xl border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Item</th>
                <th className="text-left px-4 py-3">Categoria</th>
                <th className="text-right px-4 py-3">Qtd padrão</th>
                <th className="text-left px-4 py-3">Ativo</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id} className="border-t">
                  <td className="px-4 py-3">{m.name}</td>
                  <td className="px-4 py-3 text-slate-500">{m.category || '—'}</td>
                  <td className="px-4 py-3 text-right font-mono">{m.expected_quantity ?? '—'}</td>
                  <td className="px-4 py-3"><Switch checked={m.active !== false} onCheckedChange={() => toggle.mutate(m)} /></td>
                  <td className="px-4 py-3 text-right"><button onClick={() => del.mutate(m.id)} className="text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-500">Os itens ativos aparecem na conferência feita durante a limpeza.</p>
    </div>
  );
}