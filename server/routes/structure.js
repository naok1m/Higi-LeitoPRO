import { updateEntities } from '../db/entityStore.js';
import { ApiError } from '../http/errors.js';
import { sendJson } from '../http/io.js';
import { getEntityRecords, getRecordCompanyId, getUserRole } from '../services/access.js';
import { getSessionUser } from '../services/authSessions.js';
import { publishChange } from '../services/changes.js';

export const structureHandler = async (request, response, url) => {
  if (url.pathname !== '/api/structure/purge-manual' || request.method !== 'POST') {
    throw new ApiError(404, 'not_found', 'Rota de exclusão de cadastros manuais não encontrada.');
  }
  const actor = await getSessionUser(request);
  if (!actor) {
    throw new ApiError(401, 'unauthorized', 'Entre na sua conta para excluir os cadastros manuais.');
  }
  if (getUserRole(actor) !== 'admin') {
    throw new ApiError(403, 'forbidden', 'Somente o administrador de TI pode excluir os cadastros manuais.');
  }

  const deleted = await updateEntities({
    entities: ['Bed', 'Unit', 'CleaningTask'],
    companyId: actor.activeCompanyId,
  }, (database) => {
    const beds = getEntityRecords(database, 'Bed');
    const units = getEntityRecords(database, 'Unit');
    const tasks = getEntityRecords(database, 'CleaningTask');
    const deletedBeds = beds.filter((bed) =>
      getRecordCompanyId(bed) === actor.activeCompanyId && bed.oracle_source !== 'oracle');
    const deletedUnits = units.filter((unit) =>
      getRecordCompanyId(unit) === actor.activeCompanyId && unit.oracle_source !== 'oracle');
    const deletedBedIds = new Set(deletedBeds.map((bed) => bed.id));
    const preservedHistoryCount = tasks.filter((task) =>
      getRecordCompanyId(task) === actor.activeCompanyId && deletedBedIds.has(task.bed_id)).length;

    database.entities.Bed = beds.filter((bed) => !deletedBedIds.has(bed.id));
    const deletedUnitIds = new Set(deletedUnits.map((unit) => unit.id));
    database.entities.Unit = units.filter((unit) => !deletedUnitIds.has(unit.id));

    return { beds: deletedBeds, units: deletedUnits, preservedHistoryCount };
  });

  for (const bed of deleted.beds) {
    await publishChange({ event: 'entity.deleted', entity: 'Bed', record: bed, actor });
  }
  for (const unit of deleted.units) {
    await publishChange({ event: 'entity.deleted', entity: 'Unit', record: unit, actor });
  }
  sendJson(response, 200, {
    deletedBeds: deleted.beds.length,
    deletedUnits: deleted.units.length,
    preservedHistoryCount: deleted.preservedHistoryCount,
  });
};
