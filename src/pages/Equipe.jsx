import { db } from '@/api/localClient';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Clock3, Trash2 } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { getWorkScheduleLabel, isValidWorkSchedule, weekdays, workScheduleOptions } from '@/lib/workSchedule';

const shifts = { manha: 'Manhã', tarde: 'Tarde', noite: 'Noite' };
const functionLabels = { higienizacao: 'Higienização e limpeza', rouparia: 'Rouparia' };
const localDateValue = (date) => {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
};
const emptyWorkSchedule = () => ({
  type: '',
  startDate: localDateValue(new Date()),
  startTime: '',
  endTime: '',
  weekdays: [],
});
const normaliseWorkSchedule = (schedule) => ({
  ...emptyWorkSchedule(),
  ...(schedule && typeof schedule === 'object' && !Array.isArray(schedule) ? schedule : {}),
  weekdays: Array.isArray(schedule?.weekdays) ? [...schedule.weekdays] : [],
});
const getShiftForSchedule = (schedule) => {
  if (schedule.type === '12x36_manha') return 'manha';
  if (schedule.type === '12x36_noite') return 'noite';
  if (schedule.type === 'comercial') {
    const startHour = Number(schedule.startTime?.slice(0, 2));
    if (startHour >= 18) return 'noite';
    return startHour < 12 ? 'manha' : 'tarde';
  }
  return undefined;
};

function WorkScheduleFields({ schedule, onChange }) {
  const update = (field, value) => onChange((previous) => ({ ...previous, [field]: value }));
  const selectedWeekdays = Array.isArray(schedule.weekdays) ? schedule.weekdays : [];
  const toggleWeekday = (day) => update('weekdays', selectedWeekdays.includes(day)
    ? selectedWeekdays.filter((value) => value !== day)
    : [...selectedWeekdays, day].sort((a, b) => a - b));
  const invalidCommercialHours = schedule.type === 'comercial'
    && schedule.startTime && schedule.endTime
    && schedule.endTime <= schedule.startTime;

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <label className="grid gap-1 text-sm text-slate-600">
        Escala de trabalho
        <select value={schedule.type || ''} onChange={(event) => update('type', event.target.value)}
          className="h-10 rounded-md border bg-white px-3 text-slate-900">
          <option value="">Selecione a escala</option>
          {workScheduleOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {(schedule.type === '12x36_manha' || schedule.type === '12x36_noite') && (
        <label className="grid gap-1 text-sm text-slate-600">
          Primeiro dia trabalhado do ciclo
          <input type="date" value={schedule.startDate || ''}
            onChange={(event) => update('startDate', event.target.value)}
            className="h-10 rounded-md border bg-white px-3 text-slate-900" />
        </label>
      )}
      {schedule.type === 'comercial' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-sm text-slate-600">
              Início
              <input type="time" value={schedule.startTime || ''}
                onChange={(event) => update('startTime', event.target.value)}
                className="h-10 rounded-md border bg-white px-3 text-slate-900" />
            </label>
            <label className="grid gap-1 text-sm text-slate-600">
              Fim
              <input type="time" value={schedule.endTime || ''}
                onChange={(event) => update('endTime', event.target.value)}
                className="h-10 rounded-md border bg-white px-3 text-slate-900" />
            </label>
          </div>
          <fieldset>
            <legend className="mb-1 text-sm text-slate-600">Dias trabalhados</legend>
            <div className="flex flex-wrap gap-2">
              {weekdays.map(({ value, label }) => (
                <label key={value} className="flex items-center gap-1 rounded-md border bg-white px-2 py-1 text-sm">
                  <input type="checkbox" checked={selectedWeekdays.includes(value)}
                    onChange={() => toggleWeekday(value)} />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        </>
      )}
      {invalidCommercialHours && (
        <p role="alert" className="text-xs text-red-700">O horário final deve ser posterior ao horário inicial.</p>
      )}
      {schedule.type === 'comercial' && selectedWeekdays.length === 0 && (
        <p role="alert" className="text-xs text-red-700">Selecione ao menos um dia de trabalho.</p>
      )}
      {!schedule.type && <p className="text-xs text-slate-500">A escala é necessária para calcular o percentual de produtividade.</p>}
    </div>
  );
}

export default function Equipe() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [form, setForm] = useState({
    name: '',
    registration: '',
    function: 'higienizacao',
    phone: '',
    company_id: user?.activeCompanyId || '',
    work_schedule: emptyWorkSchedule(),
  });
  const [editingSchedule, setEditingSchedule] = useState(null);
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
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['employees'] });
    qc.invalidateQueries({ queryKey: ['employees-active'] });
    qc.invalidateQueries({ queryKey: ['productivity-report'] });
  };
  const add = useMutation({
    mutationFn: () => db.entities.Employee.create({
      ...form,
      name: form.name.trim(),
      registration: form.registration.trim(),
      shift: getShiftForSchedule(form.work_schedule),
      work_schedule: form.work_schedule,
      active: true,
    }),
    onSuccess: () => {
      setForm({
        name: '',
        registration: '',
        function: 'higienizacao',
        phone: '',
        company_id: user?.activeCompanyId || '',
        work_schedule: emptyWorkSchedule(),
      });
      refresh();
    },
    onError: (error) => toast.error(error.message || 'Não foi possível cadastrar o colaborador.'),
  });
  const saveSchedule = useMutation({
    mutationFn: ({ id, schedule }) => db.entities.Employee.update(id, {
      work_schedule: schedule,
      shift: getShiftForSchedule(schedule),
    }),
    onSuccess: () => {
      setEditingSchedule(null);
      refresh();
      toast.success('Escala de trabalho atualizada.');
    },
    onError: (error) => toast.error(error.message || 'Não foi possível atualizar a escala.'),
  });
  const toggle = useMutation({
    mutationFn: /** @type {import('@tanstack/react-query').MutationFunction<unknown, { id: string; active: boolean }>} */ (
      (e) => db.entities.Employee.update(e.id, { active: !e.active })
    ),
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
      <div className="space-y-3 rounded-2xl border bg-white p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Input placeholder="Nome" value={form.name} onChange={set('name')} className="h-11" />
          <Input placeholder="Matrícula" value={form.registration} onChange={set('registration')} className="h-11" />
          <select value={form.function} onChange={set('function')} className="h-11 rounded-md border bg-white px-3 text-sm">
            {Object.entries(functionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select aria-label="Empresa do colaborador" value={form.company_id} onChange={set('company_id')}
            className="h-11 rounded-md border bg-white px-3 text-sm">
            {user?.companies?.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
          </select>
        </div>
        <WorkScheduleFields schedule={form.work_schedule}
          onChange={(update) => setForm((previous) => ({ ...previous, work_schedule: update(previous.work_schedule) }))} />
        <Button className="h-11 bg-primary hover:bg-primary/90"
          disabled={!form.name.trim() || !form.registration.trim() || !form.company_id
            || !isValidWorkSchedule(form.work_schedule) || add.isPending}
          onClick={() => add.mutate()}>Cadastrar</Button>
      </div>
      <div className="space-y-2">
        {isLoading && <p className="text-sm text-slate-500">Carregando equipe...</p>}
        {isError && <p role="alert" className="text-sm text-red-700">{error.message}</p>}
        {(data?.items || []).map((e) => (
          <div key={e.id} className="bg-white rounded-2xl border p-4 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{e.name}</p>
              <p className="text-xs text-slate-500">
                Mat. {e.registration} · {functionLabels[e.function] || functionLabels.higienizacao} · {shifts[e.shift] || e.shift}
              </p>
              <p className="mt-1 text-xs text-slate-500">{getWorkScheduleLabel(e.work_schedule)}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setEditingSchedule(
              editingSchedule?.id === e.id
                ? null
                : { id: e.id, value: normaliseWorkSchedule(e.work_schedule) },
            )}>
              <Clock3 />
              Escala
            </Button>
            <Switch checked={e.active !== false} onCheckedChange={() => toggle.mutate(e)} />
            <button onClick={() => remove.mutate(e.id)} className="text-slate-400 hover:text-red-500 p-2"><Trash2 className="w-4 h-4" /></button>
            {editingSchedule?.id === e.id && (
              <div className="w-full basis-full">
                <WorkScheduleFields schedule={editingSchedule.value}
                  onChange={(update) => setEditingSchedule((previous) => ({
                    ...previous,
                    value: update(previous.value),
                  }))} />
                <div className="mt-2 flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setEditingSchedule(null)}>Cancelar</Button>
                  <Button disabled={!isValidWorkSchedule(editingSchedule.value) || saveSchedule.isPending}
                    onClick={() => saveSchedule.mutate({ id: e.id, schedule: editingSchedule.value })}>
                    Salvar escala
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
        {data && data.items.length === 0 && <p className="text-sm text-slate-500">Nenhum colaborador cadastrado.</p>}
      </div>
    </div>
  );
}