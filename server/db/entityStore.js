import { entityNames, getRecordCompanyId } from '../services/access.js';
import { withTransaction } from './pool.js';

// Todas as escritas de registros passam por este lock, dentro de uma transação.
// Assim API e worker nunca alteram leitos/tarefas ao mesmo tempo (era o papel da
// fila em memória do antigo users.json) e uma falha no meio desfaz tudo.
const ENTITY_WRITE_LOCK_KEY = 7208541002;

export const NO_DATABASE_CHANGE = Symbol('no-database-change');

/*
 * Escopo de uma operação:
 *   entities:  entidades a carregar, ex. ['Bed', 'CleaningTask']
 *   companyId: carrega só os registros dessa empresa (omitido = todas)
 *   filters:   por entidade, lista de condições OU sobre campos texto do registro,
 *              ex. { CleaningTask: [{ status: 'em_andamento' }, { id: taskId }] }.
 *              Lista vazia = não carrega nada (útil para só inserir).
 *
 * Os handlers trabalham com `database.entities[Nome]` como arrays em memória.
 * Ao final, só o que mudou dentro do recorte carregado é gravado: registros novos
 * são inseridos, alterados são atualizados e os que sumiram do array são excluídos.
 * Acessar uma entidade fora do escopo gera erro, para nunca gravar com dados parciais.
 */
const loadRecords = async (client, entity, { companyId, conditions }) => {
  const params = [entity];
  const where = ['entity = $1'];
  if (companyId) {
    params.push(companyId);
    where.push(`company_id = $${params.length}`);
  }
  if (conditions) {
    if (conditions.length === 0) return [];
    const alternatives = conditions.map((condition) => {
      const parts = Object.entries(condition).map(([field, value]) => {
        if (typeof value !== 'string') throw new Error(`Filtro de ${entity}.${field} deve ser texto.`);
        params.push(field, value);
        return `data ->> $${params.length - 1} = $${params.length}`;
      });
      return `(${parts.join(' and ')})`;
    });
    where.push(`(${alternatives.join(' or ')})`);
  }
  const { rows } = await client.query(
    `select data from entity_records where ${where.join(' and ')} order by seq`,
    params,
  );
  return rows.map(({ data }) => data);
};

const loadScope = async (client, { entities, companyId, filters = {} }) => {
  for (const entity of entities) {
    if (!entityNames.includes(entity)) throw new Error(`Entidade desconhecida: ${entity}.`);
  }
  const loaded = {};
  const snapshots = new Map();
  for (const entity of entities) {
    const records = await loadRecords(client, entity, { companyId, conditions: filters[entity] });
    loaded[entity] = records;
    snapshots.set(entity, new Map(records.map((record) => [record.id, JSON.stringify(record)])));
  }

  const guard = (entity) => {
    if (typeof entity === 'string' && entityNames.includes(entity) && !Object.hasOwn(loaded, entity)) {
      throw new Error(`A entidade ${entity} não foi carregada nesta operação.`);
    }
  };
  const entitiesView = new Proxy(loaded, {
    get(target, entity) {
      guard(entity);
      return target[entity];
    },
    set(target, entity, value) {
      guard(entity);
      target[entity] = value;
      return true;
    },
  });
  return { database: { entities: entitiesView }, loaded, snapshots };
};

const persistScope = async (client, { loaded, snapshots }) => {
  for (const [entity, snapshot] of snapshots) {
    const records = loaded[entity];
    if (!Array.isArray(records)) throw new Error(`Os registros de ${entity} devem ser uma lista.`);
    const seen = new Set();
    for (const record of records) {
      if (!record || typeof record !== 'object' || typeof record.id !== 'string' || !record.id) {
        throw new Error(`Registro de ${entity} sem identificador válido.`);
      }
      if (seen.has(record.id)) throw new Error(`Registro duplicado em ${entity}: ${record.id}.`);
      seen.add(record.id);

      const json = JSON.stringify(record);
      const previous = snapshot.get(record.id);
      if (previous === json) continue;
      const companyId = getRecordCompanyId(record);
      if (previous === undefined) {
        await client.query(
          'insert into entity_records (entity, id, company_id, data) values ($1, $2, $3, $4)',
          [entity, record.id, companyId, json],
        );
      } else {
        await client.query(
          'update entity_records set data = $3, company_id = $4, updated_at = now() where entity = $1 and id = $2',
          [entity, record.id, json, companyId],
        );
      }
    }
    const removedIds = [...snapshot.keys()].filter((id) => !seen.has(id));
    if (removedIds.length) {
      await client.query('delete from entity_records where entity = $1 and id = any($2)', [entity, removedIds]);
    }
  }
};

export const readEntities = (scope) => withTransaction(
  async (client) => (await loadScope(client, scope)).database,
  { readOnly: true, isolation: 'repeatable read' },
);

// `update(database, client)` pode lançar ApiError para cancelar tudo, ou devolver
// NO_DATABASE_CHANGE quando não há nada a gravar.
export const updateEntities = (scope, update) => withTransaction(async (client) => {
  await client.query('select pg_advisory_xact_lock($1)', [ENTITY_WRITE_LOCK_KEY]);
  const view = await loadScope(client, scope);
  const result = await update(view.database, client);
  if (result === NO_DATABASE_CHANGE) return null;
  await persistScope(client, view);
  return result;
});

// Usado pelos testes e pela importação do users.json antigo.
export const insertEntityRecords = async (client, entity, records) => {
  for (const record of records) {
    await client.query(
      `insert into entity_records (entity, id, company_id, data) values ($1, $2, $3, $4)
       on conflict (entity, id) do nothing`,
      [entity, record.id, getRecordCompanyId(record), JSON.stringify(record)],
    );
  }
};
