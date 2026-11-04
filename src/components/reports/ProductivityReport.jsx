import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { db } from '@/api/localClient';
import ReportTable from './ReportTable';
import ReportChart from './ReportChart';
import { formatDuration } from '@/components/beds/Timer';
import { getStageDurationSeconds } from '@/lib/bedWorkflow';
import { getScheduledSeconds } from '@/lib/workSchedule';
import { Button } from '@/components/ui/button';

const stages = [
  { key: 'higienizacao', label: 'Limpeza', startField: 'higienizacao_started_at' },
  { key: 'rouparia', label: 'Rouparia', startField: 'rouparia_started_at' },
  { key: 'revisao', label: 'Revisão', startField: 'revisao_started_at' },
];

const periodBounds = (period) => ({
  $gte: new Date(`${period.from}T00:00:00`).toISOString(),
  $lte: new Date(`${period.to}T23:59:59.999`).toISOString(),
});

const getStageStart = (task, stage) =>
  task[stage.startField] || (stage.key === 'higienizacao' ? task.started_at : null);

const getStageOwner = (task, stage, employeesById, employeesByName) => {
  let employeeId;
  let name;
  if (stage.key === 'higienizacao') {
    employeeId = task.employee_id;
    name = task.employee_name;
  } else if (stage.key === 'rouparia') {
    employeeId = task.rouparia_employee_id;
    name = employeesById.get(employeeId)?.name || task.rouparia_employee_name || task.rouparia_by;
  } else {
    name = task.reviewed_by || task.revisao_started_by;
  }
  const employee = employeesById.get(employeeId)
    || (name ? employeesByName.get(name.trim().toLocaleLowerCase('pt-BR')) : null);
  return {
    employee,
    id: employee?.id || employeeId || null,
    name: employee?.name || name?.trim() || '',
  };
};

const getStageSeconds = (task, stage, now) => {
  const saved = Number(task[`${stage.key}_duration_seconds`]);
  const startedAt = getStageStart(task, stage);
  if (task.status === 'em_andamento'
    && (task.workflow_stage || 'higienizacao') === stage.key
    && startedAt
    && !task.maintenance_started_at) {
    return getStageDurationSeconds(task, stage.key, now);
  }
  return Number.isFinite(saved) && saved >= 0 ? saved : 0;
};

const isWithinPeriod = (value, period) => {
  const time = Date.parse(value);
  return Number.isFinite(time)
    && time >= Date.parse(`${period.from}T00:00:00`)
    && time <= Date.parse(`${period.to}T23:59:59.999`);
};

const loadReportData = async (period) => {
  const bounds = periodBounds(period);
  const taskQuery = (field) => db.entities.CleaningTask.filter({
    status: { $in: ['em_andamento', 'concluida'] },
    [field]: bounds,
  }, { sort: `-${field}`, limit: 5000 });
  const [employees, hygieneByStageTime, hygieneByStart, linenTasks, reviewTasks] = await Promise.all([
    db.entities.Employee.filter({}, { sort: 'name', limit: 1000 }),
    taskQuery('higienizacao_started_at'),
    taskQuery('started_at'),
    taskQuery('rouparia_started_at'),
    taskQuery('revisao_started_at'),
  ]);
  if ([hygieneByStageTime, hygieneByStart, linenTasks, reviewTasks]
    .some((result) => result.items?.length >= 5000)) {
    throw new Error('O período contém muitas operações para uma única consulta. Reduza o intervalo de datas e tente novamente.');
  }
  const uniqueTasks = new Map();
  for (const result of [hygieneByStageTime, hygieneByStart, linenTasks, reviewTasks]) {
    for (const task of result.items || []) uniqueTasks.set(task.id, task);
  }

  const employeesById = new Map((employees.items || []).map((employee) => [employee.id, employee]));
  const employeesByName = new Map((employees.items || [])
    .map((employee) => [employee.name.trim().toLocaleLowerCase('pt-BR'), employee]));
  const now = Date.now();
  const contributors = new Map();
  const operations = [];

  for (const task of uniqueTasks.values()) {
    for (const stage of stages) {
      const startedAt = getStageStart(task, stage);
      if (!startedAt || !isWithinPeriod(startedAt, period)) continue;
      const owner = getStageOwner(task, stage, employeesById, employeesByName);
      if (!owner.name) continue;

      const personKey = owner.id ? `employee:${owner.id}` : `name:${owner.name.toLocaleLowerCase('pt-BR')}`;
      const operation = {
        id: `${task.id}:${stage.key}`,
        taskId: task.id,
        personKey,
        employeeName: owner.name,
        stage: stage.key,
        stageLabel: stage.label,
        bedCode: task.bed_code || '—',
        unitName: task.unit_name || '—',
        startedAt,
        seconds: getStageSeconds(task, stage, now),
      };
      operations.push(operation);
      if (!contributors.has(personKey)) {
        contributors.set(personKey, {
          id: owner.id,
          name: owner.name,
          employee: owner.employee,
          operations: [],
          byStage: Object.fromEntries(stages.map(({ key }) => [key, { count: 0, seconds: 0 }])),
        });
      }
      const contributor = contributors.get(personKey);
      contributor.operations.push(operation);
      contributor.byStage[stage.key].count += 1;
      contributor.byStage[stage.key].seconds += operation.seconds;
    }
  }

  const rows = [...contributors.values()].map((contributor) => ({
    ...contributor,
    totalSeconds: stages.reduce((total, { key }) => total + contributor.byStage[key].seconds, 0),
    scheduledSeconds: contributor.employee
      ? getScheduledSeconds(contributor.employee.work_schedule, period.from, period.to)
      : null,
  })).sort((a, b) => b.totalSeconds - a.totalSeconds || a.name.localeCompare(b.name, 'pt-BR'));

  return { rows, operations };
};

const percent = (part, total) => total ? `${(part / total * 100).toFixed(1)}%` : '—';
const showDuration = (value) => Number.isFinite(value) ? formatDuration(value) : '—';
const average = (stats) => stats.count ? Math.round(stats.seconds / stats.count) : null;

function EmployeeAnalytics({ employee, period, onBack }) {
  const scheduleSeconds = employee.scheduledSeconds;
  const totalSeconds = employee.totalSeconds;
  const averageByStage = Object.fromEntries(stages.map(({ key }) => [
    key,
    average(employee.byStage[key]),
  ]));
  const operations = [...employee.operations]
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));

  return (
    <div className="space-y-4">
      <Button variant="outline" onClick={onBack} className="print:hidden">
        <ArrowLeft />
        Voltar à produtividade
      </Button>
      <div>
        <h3 className="text-xl font-semibold text-slate-900">Análise de {employee.name}</h3>
        <p className="text-sm text-slate-500">Período: {period.from} a {period.to}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border bg-white p-4">
          <p className="text-xs text-slate-500">Tempo de operação (T.O.)</p>
          <p className="font-mono text-xl font-semibold">{formatDuration(totalSeconds)}</p>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <p className="text-xs text-slate-500">Escala de trabalho (E.T.)</p>
          <p className="font-mono text-xl font-semibold">{showDuration(scheduleSeconds)}</p>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <p className="text-xs text-slate-500">T.O. / E.T.</p>
          <p className="font-mono text-xl font-semibold">
            {formatDuration(totalSeconds)} / {showDuration(scheduleSeconds)}
          </p>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <p className="text-xs text-slate-500">Ocupação da escala</p>
          <p className="font-mono text-xl font-semibold">{percent(totalSeconds, scheduleSeconds)}</p>
        </div>
      </div>
      {scheduleSeconds === null && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Cadastre a escala deste colaborador na aba Equipe para calcular E.T. e o percentual.
        </p>
      )}
      <ReportTable period={period} rows={operations} columns={[
        { label: 'Colaborador', render: (operation) => operation.employeeName },
        { label: 'Leito', render: (operation) => operation.bedCode },
        { label: 'Unidade', render: (operation) => operation.unitName },
        { label: 'Operação', render: (operation) => operation.stageLabel },
        { label: 'Início', render: (operation) => new Date(operation.startedAt).toLocaleString('pt-BR') },
        { label: 'Tempo de operação (T.O.)', right: true, render: (operation) => formatDuration(operation.seconds) },
        { label: 'Tempo médio da operação', right: true, render: (operation) => showDuration(averageByStage[operation.stage]) },
        { label: 'T.O. / E.T.', right: true, render: (operation) => `${formatDuration(operation.seconds)} / ${showDuration(scheduleSeconds)}` },
        { label: '% da escala', right: true, render: (operation) => percent(operation.seconds, scheduleSeconds) },
      ]} empty="Nenhuma operação deste colaborador no período." />
    </div>
  );
}

export default function ProductivityReport({ period }) {
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [selectedStage, setSelectedStage] = useState(stages[0].key);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['productivity-report', period],
    queryFn: () => loadReportData(period),
    refetchInterval: 30000,
  });
  const rows = data?.rows || [];
  const operations = data?.operations || [];
  const selected = rows.find((row) => row.id === selectedEmployee?.id
    && row.name === selectedEmployee?.name);
  const activeStage = stages.find((stage) => stage.key === selectedStage) || stages[0];
  const chartRows = rows
    .map((row) => ({ name: row.name, value: row.byStage[activeStage.key].seconds }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'pt-BR'));

  if (isError) return <p role="alert" className="text-sm text-red-700">{error.message}</p>;

  if (selected) {
    return (
      <EmployeeAnalytics
        employee={selected}
        period={period}
        onBack={() => setSelectedEmployee(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Os tempos são contabilizados por etapa, mesmo que o processo do leito ainda não tenha terminado.
        A escala considera os dias e horários cadastrados para cada colaborador.
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <div className="rounded-2xl border bg-white p-4">
          <p className="text-xs text-slate-500">Operações registradas</p>
          <p className="text-xl font-semibold">{isLoading ? '—' : operations.length}</p>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <p className="text-xs text-slate-500">Colaboradores com operações</p>
          <p className="text-xl font-semibold">{isLoading ? '—' : rows.length}</p>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <p className="text-xs text-slate-500">Tempo de operação total</p>
          <p className="font-mono text-xl font-semibold">
            {isLoading ? '—' : formatDuration(rows.reduce((total, row) => total + row.totalSeconds, 0))}
          </p>
        </div>
      </div>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Etapa do gráfico de produtividade">
          {stages.map((stage) => {
            const active = selectedStage === stage.key;
            const operationCount = rows.reduce(
              (total, row) => total + row.byStage[stage.key].count,
              0,
            );
            return (
              <button
                key={stage.key}
                type="button"
                aria-label={`${stage.label}: ${operationCount} operações`}
                aria-pressed={active}
                onClick={() => setSelectedStage(stage.key)}
                className={`rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'border-primary bg-primary text-white shadow-sm'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {stage.label}
                <span className={`ml-2 text-xs ${active ? 'text-white/80' : 'text-slate-400'}`}>
                {operationCount} op.
                </span>
              </button>
            );
          })}
        </div>
        <ReportChart
          title={`Tempo de operação por colaborador · ${activeStage.label}`}
          color={['#086986', '#0284c7', '#7c3aed'][stages.indexOf(activeStage)]}
          horizontal
          format={formatDuration}
          rows={chartRows}
        />
      </div>
      <ReportTable loading={isLoading} period={period} rows={rows} columns={[
        {
          label: 'Colaborador',
          render: (row) => (
            <button type="button" className="font-medium text-primary underline-offset-2 hover:underline"
              onClick={() => setSelectedEmployee({ id: row.id, name: row.name })}>
              {row.name}
            </button>
          ),
        },
        ...stages.map((stage) => ({
          label: stage.label,
          right: true,
          render: (row) => (
            <div className="min-w-32 space-y-1">
              <div className="flex items-center justify-end gap-2">
                <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                  {row.byStage[stage.key].count} op.
                </span>
                <span className="font-mono tabular-nums">
                  {formatDuration(row.byStage[stage.key].seconds)}
                </span>
              </div>
              <p className="text-xs font-normal text-slate-500">
                média {showDuration(average(row.byStage[stage.key]))}
              </p>
            </div>
          ),
          exportValue: (row) => [
            `${row.byStage[stage.key].count} operações`,
            formatDuration(row.byStage[stage.key].seconds),
            `média ${showDuration(average(row.byStage[stage.key]))}`,
          ].join(' · '),
        })),
        { label: 'T.O. total', right: true, render: (row) => formatDuration(row.totalSeconds) },
        { label: 'E.T. período', right: true, render: (row) => showDuration(row.scheduledSeconds) },
        { label: 'Ocupação', right: true, render: (row) => percent(row.totalSeconds, row.scheduledSeconds) },
      ]} empty="Nenhuma operação iniciada no período selecionado." />
    </div>
  );
}
