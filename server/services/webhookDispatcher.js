import { createHmac } from 'node:crypto';
import { getConfig } from '../config/env.js';
import { query } from '../db/pool.js';

const MAX_ATTEMPTS = 10;
const BATCH_SIZE = 20;

// Espera crescente entre tentativas: 10s, 20s, 40s... até 30 minutos.
const retryDelaySeconds = (attempts) => Math.min(30 * 60, 10 * 2 ** (attempts - 1));

const deliver = async (payload, { url, secret }) => {
  const body = JSON.stringify(payload);
  const signature = secret ? `sha256=${createHmac('sha256', secret).update(body).digest('hex')}` : null;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Higi-Event': payload.event,
      'X-Higi-Delivery': payload.id,
      ...(signature ? { 'X-Higi-Signature': signature } : {}),
    },
    body,
    signal: AbortSignal.timeout(5000),
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error(`O webhook respondeu com HTTP ${response.status}.`);
};

// Entrega os eventos pendentes da tabela change_events. Roda só no worker.
// Devolve quantos eventos foram processados nesta rodada.
export const dispatchPendingWebhooks = async () => {
  const webhook = getConfig().webhook;
  if (!webhook.url) return 0;

  const { rows } = await query(
    `select id, payload, webhook_attempts
       from change_events
      where webhook_status = 'pending'
        and (webhook_next_attempt_at is null or webhook_next_attempt_at <= now())
      order by occurred_at
      limit $1`,
    [BATCH_SIZE],
  );

  for (const event of rows) {
    const attempts = event.webhook_attempts + 1;
    try {
      await deliver(event.payload, webhook);
      await query(
        `update change_events
            set webhook_status = 'delivered', webhook_attempts = $2, webhook_delivered_at = now(),
                webhook_last_error = null, webhook_next_attempt_at = null
          where id = $1`,
        [event.id, attempts],
      );
    } catch (error) {
      const failed = attempts >= MAX_ATTEMPTS;
      await query(
        `update change_events
            set webhook_status = $3, webhook_attempts = $2, webhook_last_error = $4,
                webhook_next_attempt_at = case when $3 = 'pending' then now() + make_interval(secs => $5) end
          where id = $1`,
        [event.id, attempts, failed ? 'failed' : 'pending', String(error.message || error).slice(0, 1000), retryDelaySeconds(attempts)],
      );
    }
  }
  return rows.length;
};
