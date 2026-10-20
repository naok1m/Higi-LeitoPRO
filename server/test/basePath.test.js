import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { startTestDatabase } from './helpers.js';

// API publicada em /higi atrás de um proxy na mesma máquina (modo do install-proxy.ps1).
const database = await startTestDatabase();
const port = 40000 + Math.floor(Math.random() * 10000);
const origin = `http://127.0.0.1:${port}`;
let apiProcess;
let output = '';

before(async () => {
  apiProcess = spawn(process.execPath, [path.resolve(import.meta.dirname, '..', 'api.js')], {
    env: {
      ...process.env,
      HIGI_SKIP_ENV_FILE: '1',
      DATABASE_URL: database.url,
      PORT: String(port),
      HOST: '127.0.0.1',
      HIGI_BASE_PATH: '/higi',
      HIGI_ADMIN_EMAIL: 'ti@example.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  apiProcess.stdout.on('data', (chunk) => { output += chunk; });
  apiProcess.stderr.on('data', (chunk) => { output += chunk; });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(`${origin}/higi/api/health`)).ok) return;
    } catch {
      // ainda subindo
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`API não subiu:\n${output}`);
});

after(async () => {
  await new Promise((resolve) => {
    apiProcess.once('exit', resolve);
    apiProcess.kill();
  });
  await database.stop();
});

const bootstrap = (headers = {}) => fetch(`${origin}/higi/api/auth/bootstrap-admin`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify({ email: 'ti@example.test', password: 'senha-segura-admin' }),
});

test('serves the app under the base path', async () => {
  const redirect = await fetch(`${origin}/higi?x=1`, { redirect: 'manual' });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get('location'), '/higi/?x=1');
  assert.equal((await fetch(`${origin}/higi/api/health`)).status, 200);
  assert.equal((await fetch(`${origin}/api/health`)).status, 200);
  assert.equal((await fetch(`${origin}/higi/api/nao-existe`)).status, 404);
});

test('keeps server-only routes closed to network clients behind the proxy', async () => {
  const fromNetwork = await bootstrap({ 'X-Forwarded-For': '10.85.250.40' });
  assert.equal(fromNetwork.status, 403);
  assert.equal((await fromNetwork.json()).code, 'host_only');
  const spoofed = await bootstrap({ 'X-Forwarded-For': '127.0.0.1, 10.85.250.40' });
  assert.equal(spoofed.status, 403);

  const onServer = await bootstrap();
  assert.equal(onServer.status, 201);
  const cookie = onServer.headers.get('set-cookie');
  assert.match(cookie, /Path=\/higi;/);
  const me = await fetch(`${origin}/higi/api/auth/me`, { headers: { Cookie: cookie.split(';')[0] } });
  assert.equal((await me.json()).user.email, 'ti@example.test');
});
