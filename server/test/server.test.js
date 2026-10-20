import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createApiClient, startTestDatabase } from './helpers.js';

const serverDir = path.resolve(import.meta.dirname, '..');
const database = await startTestDatabase();
const port = 40000 + Math.floor(Math.random() * 10000);
const origin = `http://127.0.0.1:${port}`;
const api = createApiClient(origin);
const childEnv = {
  ...process.env,
  HIGI_SKIP_ENV_FILE: '1',
  DATABASE_URL: database.url,
  PORT: String(port),
  HOST: '127.0.0.1',
  HIGI_ADMIN_EMAIL: 'ti@example.test',
};
const children = new Set();

const startProcess = (entry) => {
  const child = spawn(process.execPath, [path.join(serverDir, entry)], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  child.output = () => output;
  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
};

const stopProcess = (child) => new Promise((resolve) => {
  if (child.exitCode !== null) {
    resolve();
    return;
  }
  child.once('exit', resolve);
  child.kill();
});

const waitForHealth = async (child) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return;
    } catch {
      // ainda subindo
    }
    if (child.exitCode !== null) throw new Error(`API encerrou ao iniciar:\n${child.output()}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`API não respondeu ao health check:\n${child.output()}`);
};

// Requisição crua, sem normalizar "/../" (é o que um atacante faria).
const rawGet = (pathname) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: pathname }, (response) => {
    let body = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => { body += chunk; });
    response.on('end', () => resolve({ status: response.statusCode, body }));
  }).on('error', reject);
});

let apiProcess;

before(async () => {
  apiProcess = startProcess('api.js');
  await waitForHealth(apiProcess);
});

after(async () => {
  await Promise.all([...children].map(stopProcess));
  await database.stop();
});

test('serves the frontend without exposing files outside dist', async () => {
  for (const pathname of ['/../package.json', '/%2e%2e/package.json', '/..%5cpackage.json', '/assets/../../package.json']) {
    const response = await rawGet(pathname);
    assert.doesNotMatch(response.body, /"higi-leito-pro"/, `${pathname} expôs o package.json`);
  }
  const unknownApi = await api('/api/nao-existe');
  assert.equal(unknownApi.status, 404);

  const spaRoute = await fetch(`${origin}/leitos`);
  if (existsSync(path.resolve(serverDir, '..', 'dist', 'index.html'))) {
    assert.equal(spaRoute.status, 200);
    assert.match(spaRoute.headers.get('content-type'), /text\/html/);
  } else {
    assert.equal(spaRoute.status, 503);
  }
  assert.equal(spaRoute.headers.get('x-content-type-options'), 'nosniff');
});

test('pushes live updates through PostgreSQL and keeps sessions across restarts', async () => {
  const admin = await api('/api/auth/bootstrap-admin', {
    method: 'POST',
    body: { email: 'ti@example.test', password: 'senha-segura-admin' },
  });
  assert.equal(admin.status, 201);

  const received = new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/api/events', headers: { Cookie: admin.cookie } }, (response) => {
      assert.equal(response.statusCode, 200);
      let buffer = '';
      response.on('data', (chunk) => {
        buffer += chunk;
        const match = buffer.match(/event: change\ndata: (.+)\n\n/);
        if (match) {
          request.destroy();
          resolve(JSON.parse(match[1]));
        }
      });
    });
    request.on('error', (error) => {
      if (error.code !== 'ECONNRESET') reject(error);
    });
    setTimeout(() => reject(new Error('Nenhum evento recebido em 5s.')), 5000);
  });
  // Dá tempo do canal abrir antes de gerar a alteração.
  await new Promise((resolve) => setTimeout(resolve, 300));
  const employee = await api('/api/entities/Employee/create', {
    method: 'POST',
    cookie: admin.cookie,
    body: { name: 'Ana', registration: 'e2e-1', function: 'higienizacao' },
  });
  assert.equal(employee.status, 201);
  assert.equal((await received).event, 'entity.created');

  await stopProcess(apiProcess);
  apiProcess = startProcess('api.js');
  await waitForHealth(apiProcess);
  const me = await api('/api/auth/me', { cookie: admin.cookie });
  assert.equal(me.payload.user?.email, 'ti@example.test');
});

test('starts the background worker without Oracle configured', async () => {
  const worker = startProcess('worker.js');
  await new Promise((resolve) => setTimeout(resolve, 2500));
  assert.equal(worker.exitCode, null, worker.output());
  assert.match(worker.output(), /worker\) iniciado/);
  await stopProcess(worker);
});
