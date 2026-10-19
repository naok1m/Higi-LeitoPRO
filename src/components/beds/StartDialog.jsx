import { useEffect, useMemo, useState } from 'react';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import EmployeeRegistrationField from '@/components/team/EmployeeRegistrationField';

export default function StartDialog({ bed, activeTasks = [], onClose, onConfirm, loading }) {
  const [employee, setEmployee] = useState(null);
  const [type, setType] = useState('terminal');
  const activeEmployeeIds = useMemo(
    () => new Set(activeTasks.map((task) => task.employee_id).filter(Boolean)),
    [activeTasks],
  );

  useEffect(() => {
    setEmployee(null);
    if (['terminal', 'concorrente'].includes(bed?.oracle_cleaning_type)) {
      setType(bed.oracle_cleaning_type);
    } else {
      setType('terminal');
    }
  }, [bed?.id, bed?.oracle_cleaning_type]);

  return (
    <Dialog open={!!bed} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Iniciar limpeza · Leito {bed?.code}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <EmployeeRegistrationField
            key={bed?.id || 'no-bed'}
            employeeFunction="higienizacao"
            busyEmployeeIds={[...activeEmployeeIds]}
            onEmployeeChange={setEmployee}
          />
          <div>
            <p className="text-sm text-slate-500 mb-1.5">Tipo de limpeza</p>
            <div className="grid grid-cols-2 gap-2">
              {['terminal', 'concorrente'].map((t) => (
                <button key={t} onClick={() => setType(t)} className={`h-12 rounded-xl border text-sm capitalize ${type === t ? 'bg-primary text-white border-primary' : 'bg-white'}`}>{t}</button>
              ))}
            </div>
          </div>
          <Button className="w-full h-12 bg-primary hover:bg-primary/90" disabled={!employee || loading}
            onClick={() => onConfirm(employee, type)}>Iniciar cronômetro</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}