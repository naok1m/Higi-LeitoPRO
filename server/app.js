import { query } from './db/pool.js';
import { ApiError } from './http/errors.js';
import { sendJson } from './http/io.js';
import { logger } from './lib/logger.js';
import { adminHandler } from './routes/admin.js';
import { authHandler } from './routes/auth.js';
import { entityHandler } from './routes/entities.js';
import { eventsHandler } from './routes/events.js';
import { oracleHandler } from './routes/oracle.js';
import { structureHandler } from './routes/structure.js';
import { workflowHandler } from './routes/workflow.js';

const healthHandler = async (request, response) => {
  try {
    await query('select 1');
    sendJson(response, 200, { status: 'ok' });
  } catch {
    sendJson(response, 503, { status: 'database_unavailable' });
  }
};

const routes = [
  ['/api/auth/', authHandler],
  ['/api/admin/', adminHandler],
  ['/api/entities/', entityHandler],
  ['/api/oracle/', oracleHandler],
  ['/api/workflow/', workflowHandler],
  ['/api/structure/', structureHandler],
];

// Middleware (request, response, next): trata tudo em /api e chama next() para o resto
// (no servidor de produção, o resto são os arquivos do frontend em dist/).
export const apiHandler = (request, response, next) => {
  const url = new URL(request.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) {
    next();
    return;
  }

  let handler;
  if (request.method === 'GET' && url.pathname === '/api/events') handler = eventsHandler;
  else if (request.method === 'GET' && url.pathname === '/api/health') handler = healthHandler;
  else handler = routes.find(([prefix]) => url.pathname.startsWith(prefix))?.[1];
  if (!handler) {
    sendJson(response, 404, { code: 'not_found', error: 'Rota da API não encontrada.' });
    return;
  }

  handler(request, response, url).catch((error) => {
    if (response.headersSent) {
      logger.error(`Falha após o início da resposta em ${request.method} ${url.pathname}.`, error);
      response.end();
      return;
    }
    if (error instanceof ApiError) {
      sendJson(response, error.status, { code: error.code, error: error.message });
      return;
    }
    logger.error(`Falha em ${request.method} ${url.pathname}.`, error);
    sendJson(response, 500, { code: 'internal_error', error: 'Não foi possível concluir a operação. Tente novamente.' });
  });
};
