import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { db } from '@/api/localClient';
import { Input } from '@/components/ui/input';

const functionLabels = {
  higienizacao: 'higienização e limpeza',
  rouparia: 'rouparia',
};

const getEmployeeFunction = (employee) => employee.function || 'higienizacao';

export default function EmployeeRegistrationField({
  employeeFunction,
  busyEmployeeIds = [],
  onEmployeeChange,
}) {
  const [registration, setRegistration] = useState('');
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['employees-active', employeeFunction],
    queryFn: () => db.entities.Employee.filter(
      { active: true, function: employeeFunction },
      { sort: 'name', limit: 200 },
    ),
  });
  const employees = useMemo(
    () => (data?.items || []).filter((employee) => getEmployeeFunction(employee) === employeeFunction),
    [data?.items, employeeFunction],
  );
  const employee = employees.find((item) => String(item.registration || '').trim() === registration.trim());
  const isBusy = employee && busyEmployeeIds.includes(employee.id);
  const availableEmployee = employee && !isBusy ? employee : null;

  const updateRegistration = (event) => {
    const value = event.target.value;
    setRegistration(value);
    const match = employees.find((item) => String(item.registration || '').trim() === value.trim());
    onEmployeeChange(match && !busyEmployeeIds.includes(match.id) ? match : null);
  };

  return (
    <div className="space-y-1.5">
      <label className="text-sm text-slate-600" htmlFor={`employee-registration-${employeeFunction}`}>
        Matrícula do colaborador
      </label>
      <Input
        id={`employee-registration-${employeeFunction}`}
        className="h-12"
        inputMode="numeric"
        autoComplete="off"
        value={registration}
        onChange={updateRegistration}
        placeholder="Digite a matrícula"
      />
      {isLoading && <p className="text-xs text-slate-500">Carregando colaboradores...</p>}
      {isError && <p role="alert" className="text-xs text-red-700">{error.message}</p>}
      {!isLoading && !isError && availableEmployee && (
        <p className="text-sm font-medium text-emerald-700">Colaborador: {availableEmployee.name}</p>
      )}
      {!isLoading && !isError && registration.trim() && !availableEmployee && (
        <p className="text-xs text-amber-700">
          {isBusy
            ? 'Este colaborador já está em uma tarefa desta função.'
            : `Matrícula não encontrada para a função ${functionLabels[employeeFunction]}.`}
        </p>
      )}
      {!isLoading && !isError && !employees.length && (
        <p className="text-xs text-amber-700">
          Não há colaboradores ativos cadastrados para {functionLabels[employeeFunction]}.
        </p>
      )}
    </div>
  );
}
