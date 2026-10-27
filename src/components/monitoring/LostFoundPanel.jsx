import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleDot, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { db } from '@/api/localClient';
import { Button } from '@/components/ui/button';

const eventLabels = { achado: 'Encontrado', perdido: 'Perdido' };

export default function LostFoundPanel() {
  const queryClient = useQueryClient();
  const [eventType, setEventType] = useState('achado');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [bedCode, setBedCode] = useState('');
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['lost-found'],
    queryFn: () => db.entities.LostFoundItem.filter({ status: 'aberto' }, { sort: '-reported_at', limit: 100 }),
    refetchInterval: 15000,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['lost-found'] });
  const createItem = useMutation({
    mutationFn: /** @type {import('@tanstack/react-query').MutationFunction<unknown, { event_type: string; description: string; location: string; bed_code: string }>} */ (
      (values) => db.entities.LostFoundItem.create(values)
    ),
    onSuccess: () => {
      setDescription('');
      setLocation('');
      setBedCode('');
      refresh();
      toast.success('Registro de achados e perdidos salvo.');
    },
    onError: (saveError) => toast.error(saveError.message || 'Não foi possível salvar o registro.'),
  });
  const resolveItem = useMutation({
    mutationFn: /** @type {import('@tanstack/react-query').MutationFunction<unknown, { id: string }>} */ ((item) => db.entities.LostFoundItem.update(item.id, {
      status: 'resolvido',
      resolved_at: new Date().toISOString(),
    })),
    onSuccess: refresh,
    onError: (saveError) => toast.error(saveError.message || 'Não foi possível atualizar o registro.'),
  });

  return (
    <section className="space-y-4 rounded-xl border bg-white p-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-900">Achados e perdidos</h3>
          <p className="text-xs text-slate-500">Registro e acompanhamento da liderança</p>
        </div>
        <CircleDot className="h-5 w-5 text-teal-700" />
      </header>
      <form className="grid gap-3 md:grid-cols-2" onSubmit={(event) => {
        event.preventDefault();
        createItem.mutate({ event_type: eventType, description, location, bed_code: bedCode });
      }}>
        <label className="grid gap-1 text-sm text-slate-600">
          Tipo
          <select value={eventType} onChange={(event) => setEventType(event.target.value)} className="h-10 rounded-md border bg-white px-3 text-slate-900">
            <option value="achado">Item encontrado</option>
            <option value="perdido">Item perdido</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm text-slate-600">
          Leito (opcional)
          <input value={bedCode} onChange={(event) => setBedCode(event.target.value)} maxLength={50}
            className="h-10 rounded-md border px-3 text-slate-900" placeholder="Código do leito" />
        </label>
        <label className="grid gap-1 text-sm text-slate-600">
          Descrição
          <input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={300} required
            className="h-10 rounded-md border px-3 text-slate-900" placeholder="Descreva o item" />
        </label>
        <label className="grid gap-1 text-sm text-slate-600">
          Local
          <input value={location} onChange={(event) => setLocation(event.target.value)} maxLength={200} required
            className="h-10 rounded-md border px-3 text-slate-900" placeholder="Onde foi encontrado ou perdido" />
        </label>
        <div className="md:col-span-2">
          <Button type="submit" className="h-10" disabled={!description.trim() || !location.trim() || createItem.isPending}>
            <Plus className="mr-2 h-4 w-4" />{createItem.isPending ? 'Salvando...' : 'Registrar item'}
          </Button>
        </div>
      </form>
      {isError && <p role="alert" className="text-sm text-red-700">{error.message}</p>}
      {isLoading && <p className="text-sm text-slate-500">Carregando registros...</p>}
      {!isLoading && !isError && !(data?.items || []).length && (
        <p className="border-t pt-3 text-sm text-slate-500">Nenhum item em aberto.</p>
      )}
      {(data?.items || []).length > 0 && (
        <div className="divide-y border-t">
          {data.items.map((item) => (
            <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">{item.description} <span className="text-xs font-normal text-slate-500">· {eventLabels[item.event_type]}</span></p>
                <p className="text-xs text-slate-500">{item.location}{item.bed_code ? ` · Leito ${item.bed_code}` : ''} · {item.reported_by}</p>
              </div>
              <Button type="button" size="sm" variant="outline" disabled={resolveItem.isPending}
                onClick={() => resolveItem.mutate(item)}>
                <Check className="mr-2 h-4 w-4" />Resolver
              </Button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}