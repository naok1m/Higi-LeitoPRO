// Processo principal: API + telas do frontend (pasta dist/). Rode com `npm start`.
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { apiHandler } from './app.js';
import { getConfig } from './config/env.js';
import { runMigrations } from './db/migrate.js';
import { closePool } from './db/pool.js';
import { closeOraclePool, configureOracleIntegration } from './integrations/oracle.js';
import { logger } from './lib/logger.js';
import { closeAllEventClients, startChangeListener } from './services/realtime.js';

const config = getConfig();
configureOracleIntegration(process.env);

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
};

const sendFile = async (response, filePath, cacheControl) => {
  const content = await readFile(filePath);
  response.writeHead(200, {
    'Content-Type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': cacheControl,
  });
  response.end(content);
};

const serveStatic = async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405).end();
    return;
  }
  const url = new URL(request.url, 'http://localhost');
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }
  const filePath = path.join(config.distDir, pathname);
  // Bloqueia "/../" para que ninguém leia arquivos fora de dist/ (ex.: o .env).
  if (filePath !== config.distDir && !filePath.startsWith(config.distDir + path.sep)) {
    response.writeHead(404).end();
    return;
  }

  try {
    // Arquivos em /assets têm hash no nome: podem ficar em cache por 1 ano.
    const cache = pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
    await sendFile(response, filePath, cache);
  } catch {
    // Rota do React (ex.: /leitos) ou arquivo inexistente: devolve o app.
    try {
      await sendFile(response, path.join(config.distDir, 'index.html'), 'no-cache');
    } catch {
      response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Frontend não encontrado. Rode "npm run build" no servidor.');
    }
  }
};

// Com HIGI_BASE_PATH=/higi, "/higi/api/..." vira "/api/..." daqui para dentro.
// Caminhos sem o prefixo continuam aceitos (health check e acesso local direto).
const stripBasePath = (request, response) => {
  const { basePath } = config;
  if (!basePath) return true;
  const queryStart = request.url.indexOf('?');
  const pathname = queryStart === -1 ? request.url : request.url.slice(0, queryStart);
  if (pathname === basePath) {
    response.writeHead(308, { Location: `${basePath}/${queryStart === -1 ? '' : request.url.slice(queryStart)}` });
    response.end();
    return false;
  }
  if (pathname.startsWith(`${basePath}/`)) request.url = request.url.slice(basePath.length);
  return true;
};

const handleRequest = (request, response) => {
  for (const [name, value] of Object.entries(securityHeaders)) response.setHeader(name, value);
  if (!stripBasePath(request, response)) return;
  apiHandler(request, response, () => {
    serveStatic(request, response).catch((error) => {
      logger.error('Falha ao servir arquivo do frontend.', error);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
};

await runMigrations();

const server = config.tls
  ? https.createServer({ pfx: readFileSync(config.tls.pfxPath), passphrase: config.tls.passphrase }, handleRequest)
  : http.createServer(handleRequest);
const stopChangeListener = startChangeListener();

server.listen(config.port, config.host, () => {
  const protocol = config.tls ? 'https' : 'http';
  logger.info(`Higi Leito PRO (API) ouvindo em ${protocol}://${config.host}:${config.port}${config.basePath}/`);
});

let shuttingDown = false;
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Encerrando API (${signal})...`);
  closeAllEventClients();
  server.close();
  server.closeAllConnections?.();
  await stopChangeListener();
  await closeOraclePool().catch((error) => logger.warn('Falha ao fechar o pool Oracle.', error));
  await closePool();
  process.exit(0);
};
for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(signal, () => void shutdown(signal));
