import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getWorkflowStage, WORKFLOW_STAGES } from '@/lib/bedWorkflow';

const NEXT_ACTIONS = {
  higienizacao: 'Concluir higienização · enviar à rouparia',
  rouparia: 'Concluir rouparia · enviar para revisão',
  revisao: 'Aprovar revisão · liberar quarto',
};

export default function WorkflowActions({
  task,
  isLeader,
  busy = false,
  onAdvance,
  onConfirmMvRelease,
  onStartStage,
  onReportMaintenance,
  onResumeMaintenance,
  canHandleRouparia = true,
}) {
  const [maintenanceDialogOpen, setMaintenanceDialogOpen] = useState(false);
  const [mvConfirmationOpen, setMvConfirmationOpen] = useState(false);
  const [reason, setReason] = useState('');
  const stage = getWorkflowStage(task);
  const stageLabel = WORKFLOW_STAGES[stage] || WORKFLOW_STAGES.higienizacao;
  const canAdvance = stage !== 'manutencao' && (stage !== 'revisao' || isLeader)
    && (stage !== 'rouparia' || canHandleRouparia);
  const stageStarted = Boolean(task[`${stage}_started_at`]);
  const canReportMaintenance = stage !== 'rouparia' || canHandleRouparia;

  const reportMaintenance = () => {
    const trimmedReason = reason.trim();
    if (!trimmedReason) return;
    onReportMaintenance(task, trimmedReason);
    setMaintenanceDialogOpen(false);
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium">Etapa: {stageLabel}</p>
      {stage === 'manutencao' ? (
        <>
          <p className="text-xs">Tempo da hotelaria congelado desde o acionamento da manutenção.</p>
          {task.maintenance_reason && <p className="text-xs">Problema: {task.maintenance_reason}</p>}
          {isLeader && (
            <button type="button" className="w-full h-11 rounded-md text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50" disabled={busy}
              onClick={() => onResumeMaintenance(task)}>
              Manutenção concluída · retomar processo
            </button>
          )}
        </>
      ) : (
        <>
          {stage === 'revisao' && !isLeader && (
            <p className="text-xs">Aguardando revisão do líder de hotelaria.</p>
          )}
          {stage === 'rouparia' && !canHandleRouparia && (
            <p className="text-xs">Etapa disponível na tela Rouparia.</p>
          )}
          {stage === 'rouparia' && canHandleRouparia && !stageStarted && (
            <button type="button" className="w-full h-11 rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
              disabled={busy} onClick={() => onStartStage(task, stage)}>
              Iniciar rouparia
            </button>
          )}
          {stage === 'revisao' && isLeader && !stageStarted && (
            <button type="button" className="w-full h-11 rounded-md text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50"
              disabled={busy} onClick={() => onStartStage(task, stage)}>
              Iniciar revisão
            </button>
          )}
          {canAdvance && stageStarted && (
            <button type="button" className="w-full h-11 rounded-md text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50" disabled={busy}
              onClick={() => onAdvance(task)}>
              {NEXT_ACTIONS[stage]}
            </button>
          )}
          {stage === 'revisao' && isLeader && task.oracle_source === 'oracle'
            && ['erro', 'enviando'].includes(task.mv_sync_status) && (
              <button type="button" className="w-full h-10 rounded-md border border-amber-300 bg-amber-50 text-amber-900 disabled:opacity-50"
                disabled={busy} onClick={() => setMvConfirmationOpen(true)}>
                Confirmar liberação já feita no MV
              </button>
          )}
          {canReportMaintenance && (
            <button type="button" className="w-full h-10 rounded-md border bg-white text-amber-800 disabled:opacity-50" disabled={busy}
              onClick={() => setMaintenanceDialogOpen(true)}>
              Acionar manutenção
            </button>
          )}
        </>
      )}

      <Dialog open={maintenanceDialogOpen} onOpenChange={(open) => !busy && setMaintenanceDialogOpen(open)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Acionar manutenção · Leito {task.bed_code}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-500">
              Ao registrar o problema, o cronômetro da hotelaria será congelado.
            </p>
            <textarea className="flex min-h-[60px] w-full rounded-md border px-3 py-2 text-sm"
              value={reason} onChange={(event) => setReason(event.target.value)}
              placeholder="Descreva o problema (ex.: ar-condicionado)" required />
            <button type="button" className="w-full h-11 rounded-md text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50"
              disabled={!reason.trim() || busy} onClick={reportMaintenance}>
              Confirmar acionamento
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={mvConfirmationOpen} onOpenChange={(open) => !busy && setMvConfirmationOpen(open)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirmar liberação no MV · Leito {task.bed_code}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Use esta opção somente depois de confirmar diretamente no MV que este leito já foi liberado.
              Nenhuma nova chamada será enviada ao MV.
            </p>
            <button type="button" className="w-full h-11 rounded-md text-white bg-amber-700 hover:bg-amber-800 disabled:opacity-50"
              disabled={busy} onClick={() => {
                onConfirmMvRelease(task);
                setMvConfirmationOpen(false);
              }}>
              Confirmar no sistema
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
