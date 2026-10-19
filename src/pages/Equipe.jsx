import { db } from '@/api/localClient';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Trash2 } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

const shifts = { manha: 'Manhã', tarde: 'Tarde', noite: 'Noite' };
const functionLabels = { higienizacao: 'Higienização e limpeza', rouparia: 'Rouparia' };

export default function Equipe() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [form, setForm] = useState({
    name: '',
    registration: '',
    function: 'higienizacao',
    shift: 'manha',
    phone: '',
    company_id: user?.activeCompanyId || '',
  });
  useEffect(() => {
    setForm((previous) => ({
      ...previous,
      company_id: user?.companies?.some((company) => company.id === previous.company_id)
        ? previous.company_id
        : user?.activeCompanyId || '',
    }));
  }, [user?.activeCompanyId, user?.companies]);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['employees'],
    queryFn: () => db.entities.Employee.filter({}, { sort: 'name', limit: 200 }),
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['employees'] }); qc.invalidateQueries({ queryKey: ['employees-active'] }); };
  const add = useMutation({
    mutationFn: () => db.entities.Employee.create({
      ...form,
      name: form.name.trim(),
      registration: form.registration.trim(),
      active: true,
    }),
    onSuccess: () => {
      setForm({
        name: '',
        registration: '',
        function: 'higienizacao',
        shift: 'manha',
        phone: '',
        company_id: user?.activeCompanyId || '',
      });
      refresh();
    },
    onError: (error) => toast.error(error.message || 'Não foi possível cadastrar o colaborador.'),
  });
  const toggle = useMutation({
    mutationFn: (e) => db.entities.Employee.update(e.id, { active: !e.active }),
    onSuccess: refresh,
    onError: (error) => toast.error(error.message || 'Não foi possível alterar o status do colaborador.'),
  });
  const remove = useMutation({
    mutationFn: (id) => db.entities.Employee.delete(id),
    onSuccess: refresh,
    onError: (error) => toast.error(error.message || 'Não foi possível remover o colaborador.'),
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="space-y-5">
      <h2 className="text-2xl font-semibold">Equipe de higienização</h2>
      <div className="bg-white rounded-2xl border p-4 grid gap-3 md:grid-cols-6">
        <Input placeholder="Nome" value={form.name} onChange={set('name')} className="h-11" />
        <Input placeholder="Matrícula" value={form.registration} onChange={set('registration')} className="h-11" />
        <select value={form.function} onChange={set('function')} className="h-11 rounded-md border px-3 text-sm bg-white">
          {Object.entries(functionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={form.shift} onChange={set('shift')} className="h-11 rounded-md border px-3 text-sm bg-white">
          {Object.entries(shifts).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select aria-label="Empresa do colaborador" value={form.company_id} onChange={set('company_id')}
          className="h-11 rounded-md border px-3 text-sm bg-white">
          {user?.companies?.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
        </select>
        <Button className="h-11 bg-primary hover:bg-primary/90"
          disabled={!form.name.trim() || !form.registration.trim() || !form.company_id || add.isPending}
          onClick={() => add.mutate()}>Cadastrar</Button>
      </div>
      <div className="space-y-2">
        {isLoading && <p className="text-sm text-slate-500">Carregando equipe...</p>}
        {isError && <p role="alert" className="text-sm text-red-700">{error.message}</p>}
        {(data?.items || []).map((e) => (
          <div key={e.id} className="bg-white rounded-2xl border p-4 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{e.name}</p>
              <p className="text-xs text-slate-500">
                Mat. {e.registration} · {functionLabels[e.function] || functionLabels.higienizacao} · {shifts[e.shift] || e.shift}
              </p>
            </div>
            <Switch checked={e.active !== false} onCheckedChange={() => toggle.mutate(e)} />
            <button onClick={() => remove.mutate(e.id)} className="text-slate-400 hover:text-red-500 p-2"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        {data && data.items.length === 0 && <p className="text-sm text-slate-500">Nenhum colaborador cadastrado.</p>}
      </div>
    </div>
  );
}