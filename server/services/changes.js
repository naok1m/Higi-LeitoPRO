import { randomUUID } from 'node:crypto';
import { getConfig } from '../config/env.js';
import { query } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import { getRecordCompanyId } from './access.js';
import { CHANGE_CHANNEL } from './realtime.js';

const livePayload = ({ id, event, occurredAt }) => JSON.stringify({ id, event, occurredAt });

// Registra a alteração na trilha de auditoria (change_events), agenda o webhook
// (o worker entrega) e avisa as telas abertas via NOTIFY. Uma falha aqui não
// desfaz a operação já gravada; só fica registrada no log.
export const publishChange = async (event) => {
  const payload = {
    id: randomUUID(),
    source: 'higi-leito-pro',
    occurredAt: new Date().toISOString(),
    ...event,
  };
  const subject = event.record || event.user || null;
  const companyId = event.record ? getRecordCompanyId(event.record) : event.actor?.activeCompanyId || null;
  try {
    await query(
      `with inserted as (
         insert into change_events
           (id, event, entity, record_id, company_id, actor_id, actor_email, payload, occurred_at, webhook_status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       )
       select pg_notify($11, $12)`,
      [
        payload.id,
        payload.event,
        event.entity || (event.user ? 'User' : null),
        subject?.id ? String(subject.id) : null,
        companyId,
        event.actor?.id || null,
        event.actor?.email || null,
        JSON.stringify(payload),
        payload.occurredAt,
        getConfig().webhook.url ? 'pending' : 'skipped',
        CHANGE_CHANNEL,
        livePayload(payload),
      ],
    );
  } catch (error) {
    logger.error(`Não foi possível registrar o evento ${payload.event} (${payload.id}).`, error);
  }
};

// Só avisa as telas abertas, sem auditoria nem webhook (ex.: sincronização do Oracle).
export const notifyClients = async (event) => {
  try {
    await query('select pg_notify($1, $2)', [
      CHANGE_CHANNEL,
      livePayload({ id: randomUUID(), event, occurredAt: new Date().toISOString() }),
    ]);
  } catch (error) {
    logger.warn(`Não foi possível avisar as telas sobre ${event}.`, error);
  }
};
