// Processo de tarefas em segundo plano: sincronização com o Oracle (MV), entrega de
// webhooks e limpeza de sessões vencidas. Rode com `npm run start:worker`.
// Fica separado da API para que lentidão ou queda do Oracle não trave as telas.
import { getConfig } from './config/env.js';
import { runMigrations } from './db/migrate.js';
import { closePool } from './db/pool.js';
import {
  closeOraclePool,
  configureOracleIntegration,
  getOraclePollIntervalMs,
  isOracleConfigured,
} from './integrations/oracle.js';
import { logger } from './lib/logger.js';
import { deleteExpiredResetTokens } from './repositories/resetTokens.js';
import { deleteExpiredSessions } from './repositories/sessions.js';
import { syncOracleCleaningBeds } from './services/oracleSync.js';
import { dispatchPendingWebhooks } from './services/webhookDispatcher.js';

getConfig();
configureOracleIntegration(process.env);
await runMigrations();

const timers = new Set();
let stopping = false;

// Repete `task` a cada `intervalMs`, sem nunca rodar duas vezes ao mesmo tempo.
// Erros iguais em sequência são registrados só uma vez para não lotar o log.
const every = (name, intervalMs, task) => {
  let lastError = null;
  const run = async () => {
    try {
      await task();
      if (lastError) logger.info(`${name}: voltou a funcionar.`);
      lastError = null;
    } catch (error) {
      const message = error.message || String(error);
      if (message !== lastError) logger.error(`${name} falhou.`, error);
      lastError = message;
    }
    if (stopping) return;
    const timer = setTimeout(() => {
      timers.delete(timer);
      void run();
    }, intervalMs);
    timers.add(timer);
  };
  void run();
};

if (isOracleConfigured()) {
  every('Sincronização Oracle', getOraclePollIntervalMs(), () => syncOracleCleaningBeds());
} else {
  logger.warn('Oracle não configurado (HIGI_ORACLE_*): a sincronização de leitos está desligada.');
}

if (getConfig().webhook.url) {
  every('Entrega de webhooks', 2000, dispatchPendingWebhooks);
}

every('Limpeza de sessões', 60 * 60 * 1000, async () => {
  const sessions = await deleteExpiredSessions();
  const tokens = await deleteExpiredResetTokens();
  if (sessions || tokens) logger.info(`Limpeza: ${sessions} sessões e ${tokens} links de senha vencidos removidos.`);
});

logger.info('Higi Leito PRO (worker) iniciado.');

const shutdown = async (signal) => {
  if (stopping) return;
  stopping = true;
  logger.info(`Encerrando worker (${signal})...`);
  for (const timer of timers) clearTimeout(timer);
  await closeOraclePool().catch((error) => logger.warn('Falha ao fechar o pool Oracle.', error));
  await closePool();
  process.exit(0);
};
for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(signal, () => void shutdown(signal));
