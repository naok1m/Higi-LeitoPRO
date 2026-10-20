import pg from 'pg';
import { getConfig } from '../config/env.js';
import { logger } from '../lib/logger.js';

// Canal do PostgreSQL (LISTEN/NOTIFY) por onde API e worker avisam que algo mudou.
export const CHANGE_CHANNEL = 'higi_changes';

// Navegadores conectados em /api/events neste processo: response -> { userId, tokenHash }.
const eventClients = new Map();

const formatChange = (data) => `event: change\ndata: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;

export const addEventClient = (response, session) => eventClients.set(response, session);

export const removeEventClient = (response) => eventClients.delete(response);

export const sendToEventClients = (matches, data) => {
  const message = formatChange(data);
  for (const [response, session] of eventClients) {
    if (matches(session)) response.write(message);
  }
};

export const closeEventClients = (matches) => {
  for (const [response, session] of eventClients) {
    if (!matches(session)) continue;
    eventClients.delete(response);
    response.end();
  }
};

export const closeAllEventClients = () => closeEventClients(() => true);

// Mantém uma conexão dedicada escutando o canal e repassa cada aviso aos navegadores.
// Se a conexão cair, reconecta e manda um aviso genérico para as telas recarregarem.
export const startChangeListener = () => {
  let current = null;
  let retryTimer = null;
  let stopped = false;
  let connectedBefore = false;

  const scheduleReconnect = (client) => {
    if (stopped || client !== current) return;
    current = null;
    client.end().catch(() => {});
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, 5000);
  };

  const connect = async () => {
    const client = new pg.Client({ connectionString: getConfig().databaseUrl, application_name: 'higi-leito-pro:listener' });
    current = client;
    client.on('notification', ({ payload }) => sendToEventClients(() => true, payload));
    client.on('error', (error) => {
      logger.warn('A escuta de alterações do PostgreSQL caiu; reconectando em 5s.', error);
      scheduleReconnect(client);
    });
    client.on('end', () => scheduleReconnect(client));
    try {
      await client.connect();
      await client.query(`listen ${CHANGE_CHANNEL}`);
      if (connectedBefore) sendToEventClients(() => true, { event: 'sync.resumed' });
      connectedBefore = true;
    } catch (error) {
      logger.warn('Não foi possível escutar alterações do PostgreSQL; nova tentativa em 5s.', error);
      scheduleReconnect(client);
    }
  };

  void connect();

  return async () => {
    stopped = true;
    clearTimeout(retryTimer);
    const client = current;
    current = null;
    await client?.end().catch(() => {});
  };
};
