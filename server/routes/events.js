import { logger } from '../lib/logger.js';
import { sendJson } from '../http/io.js';
import { isSessionActive } from '../repositories/sessions.js';
import { getRequestTokenHash, getSessionUser } from '../services/authSessions.js';
import { addEventClient, removeEventClient } from '../services/realtime.js';

// GET /api/events: canal SSE que avisa o navegador quando algo muda.
export const eventsHandler = async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) {
    sendJson(response, 401, { code: 'unauthorized', error: 'Entre na sua conta para receber atualizações.' });
    return;
  }
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  response.write(': conectado\n\n');
  const tokenHash = getRequestTokenHash(request);
  addEventClient(response, { userId: user.id, tokenHash });

  const heartbeat = setInterval(() => {
    isSessionActive(tokenHash).then((active) => {
      if (!active) {
        removeEventClient(response);
        response.end();
        return;
      }
      response.write(': heartbeat\n\n');
    }).catch((error) => {
      // Banco indisponível por um instante: mantém o canal e tenta de novo no próximo ciclo.
      logger.warn('Não foi possível validar a sessão do canal de atualizações.', error);
      response.write(': heartbeat\n\n');
    });
  }, 25000);
  request.on('close', () => {
    clearInterval(heartbeat);
    removeEventClient(response);
  });
};
