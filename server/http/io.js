import { getConfig } from '../config/env.js';
import { ApiError } from './errors.js';

export const sessionDurationMs = 12 * 60 * 60 * 1000;
const cookieName = 'higi_session';

export const sendJson = (response, status, body, headers = {}) => {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  response.end(JSON.stringify(body));
};

export const readJsonBody = async (request, maxSize = 16 * 1024) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxSize) throw new ApiError(413, 'request_too_large', 'A solicitação excede o limite permitido.');
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError(400, 'invalid_json', 'A solicitação não contém JSON válido.');
  }
};

export const getSessionToken = (request) => {
  const cookies = (request.headers.cookie || '').split(';');
  const sessionCookie = cookies.find((cookie) => cookie.trim().startsWith(`${cookieName}=`));
  return sessionCookie?.trim().slice(cookieName.length + 1) || null;
};

// "Secure" só quando o servidor roda em HTTPS; em HTTP o navegador descartaria o cookie.
const secureFlag = () => (getConfig().tls ? '; Secure' : '');
// Com HIGI_BASE_PATH, o cookie só vai para /higi e não para o outro sistema da mesma porta.
const cookiePath = () => getConfig().basePath || '/';

export const setSessionCookie = (token) =>
  `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=${cookiePath()}; Max-Age=${Math.floor(sessionDurationMs / 1000)}${secureFlag()}`;

export const clearSessionCookie = () =>
  `${cookieName}=; HttpOnly; SameSite=Strict; Path=${cookiePath()}; Max-Age=0${secureFlag()}`;

const loopbackAddresses = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

// Rotas "somente no servidor" (primeiro admin, link de redefinição, importação)
// exigem que o pedido venha do próprio servidor. Atrás do proxy (Caddy), a conexão
// sempre vem de 127.0.0.1, então também conferimos o X-Forwarded-For: o Caddy
// descarta o valor enviado pelo navegador e grava o IP real de quem acessou.
export const isHostConnection = (request) => {
  if (!loopbackAddresses.includes(request.socket.remoteAddress)) return false;
  const forwardedFor = request.headers['x-forwarded-for'];
  if (!forwardedFor) return true;
  const clientAddress = String(forwardedFor).split(',').at(-1).trim();
  return loopbackAddresses.includes(clientAddress);
};
