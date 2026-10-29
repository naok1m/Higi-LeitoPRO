import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import IdleTimer from './IdleTimer';
import Timer from './Timer';
import WorkflowActions from './WorkflowActions';
import { getWorkflowStage, WORKFLOW_STAGES } from '@/lib/bedWorkflow';

export const STATUS = {
  ocupado: { label: 'Ocupado', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  aguardando_limpeza: { label: 'Aguardando limpeza', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  em_limpeza: { label: 'Em processo de hotelaria', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  aguardando_rouparia: { label: 'Aguardando rouparia', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  em_rouparia: { label: 'Em rouparia', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  aguardando_revisao: { label: 'Aguardando revisão', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  em_revisao: { label: 'Em revisão', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  aguardando_manutencao: { label: 'Aguardando manutenção', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  livre: { label: 'Livre / Limpo', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};

export default function BedCard({
  bed, task, onStart, onSetStatus, isLeader, onStartStage,
  onAdvance, onConfirmMvRelease, onReportMaintenance, onResumeMaintenance, onCheckMaterials,
  busy, checkingMaterials, canHandleRouparia, idleLimitMinutes = 180,
}) {
  const stage = getWorkflowStage(task);
  const s = STATUS[bed.status] || STATUS.livre;
  const label = task?.status === 'em_andamento' ? WORKFLOW_STAGES[stage] : s.label;
  const stageStartedAt = task?.[`${stage}_started_at`] || (stage === 'higienizacao' ? task?.started_at : null);
  return (
    <div className={`rounded-2xl border p-4 flex flex-col gap-3 ${s.cls}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-2xl font-semibold leading-none">{bed.code}</p>
          <p className="text-xs opacity-70 mt-1">{bed.unit_name}</p>
        </div>
        <span className="text-[11px] font-medium text-right">{label}</span>
      </div>
      {bed.missing_count > 0 && (
        <p className="flex items-start gap-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{bed.missing_count} item(ns) faltando: {bed.missing_items}</span>
        </p>
      )}
      {bed.oracle_request_missing && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
          Solicitação de higienização sem código no MV.
        </p>
      )}
      {bed.status === 'aguardando_limpeza' && task?.status !== 'em_andamento'
        && Number.isFinite(Date.parse(bed.oracle_requested_at || bed.updated_date)) && (
          <div>
            <p className="text-[10px] uppercase opacity-70">Ociosidade aguardando limpeza</p>
            <IdleTimer
              startedAt={bed.oracle_requested_at || bed.updated_date}
              limitMinutes={idleLimitMinutes}
              className="text-xl font-semibold"
            />
          </div>
        )}
      {task?.status === 'em_andamento' && stage !== 'manutencao' && stageStartedAt && (
        <div>
          <Timer startedAt={stageStartedAt}
            stoppedAt={task.maintenance_started_at}
            initialSeconds={Number(task[`${stage}_duration_seconds`]) || 0}
            className="text-3xl font-semibold" />
          <p className="text-xs opacity-80 mt-1">{task.employee_name}</p>
        </div>
      )}
      {task?.status === 'em_andamento' && stage !== 'manutencao' && !stageStartedAt && (
        <div>
          <p className="text-[10px] uppercase opacity-70">Ocioso antes de {WORKFLOW_STAGES[stage]?.toLowerCase()}</p>
          <IdleTimer startedAt={task[`${stage}_idle_started_at`] || task[stage === 'rouparia' ? 'higienizacao_finished_at' : 'rouparia_finished_at']}
            stoppedAt={task.maintenance_started_at}
            initialSeconds={Number(task[`${stage}_idle_seconds`]) || 0}
            limitMinutes={idleLimitMinutes}
            className="text-xl font-semibold" />
        </div>
      )}
      {task?.status === 'em_andamento' && (
        <WorkflowActions task={task} isLeader={isLeader} busy={busy}
          onAdvance={onAdvance} onConfirmMvRelease={onConfirmMvRelease}
          onStartStage={onStartStage} onReportMaintenance={onReportMaintenance}
          onResumeMaintenance={onResumeMaintenance} canHandleRouparia={canHandleRouparia} />
      )}
      {task?.status === 'em_andamento' && isLeader && stage === 'revisao'
        && task.revisao_started_at && (
          <Button variant="outline" className="h-11 bg-white" disabled={checkingMaterials}
            onClick={() => onCheckMaterials(task)}>
            Conferir utensílios
          </Button>
        )}
      {bed.status === 'aguardando_limpeza' && <Button className="h-11 bg-amber-500 hover:bg-amber-600" onClick={() => onStart(bed)}>Iniciar limpeza</Button>}
      {bed.status === 'ocupado' && <Button variant="outline" className="h-11 bg-white" onClick={() => onSetStatus(bed, 'aguardando_limpeza')}>Paciente saiu · solicitar limpeza</Button>}
      {bed.status === 'livre' && <Button variant="outline" className="h-11 bg-white" onClick={() => onSetStatus(bed, 'ocupado')}>Marcar ocupado</Button>}
    </div>
  );
}