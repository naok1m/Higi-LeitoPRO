import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

const dataRoot = await mkdtemp(path.join(tmpdir(), 'higi-multitenant-test-'));
process.env.LOCALAPPDATA = dataRoot;

const { authApi, configureAdminBootstrap } = await import('./authApi.js');
configureAdminBootstrap('ti@example.test');

const server = createServer(authApi);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await rm(dataRoot, { recursive: true, force: true });
});

const api = async (pathname, { method = 'GET', body, cookie } = {}) => {
  const response = await fetch(`${origin}${pathname}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  return {
    status: response.status,
    payload,
    cookie: response.headers.get('set-cookie')?.split(';')[0],
  };
};

const login = async (email, password) => {
  const response = await api('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  assert.equal(response.status, 200);
  return { user: response.payload.user, cookie: response.cookie };
};

test('enforces company memberships across reads, aggregates, writes and company switching', async () => {
  const adminLogin = await api('/api/auth/bootstrap-admin', {
    method: 'POST',
    body: { email: 'ti@example.test', password: 'senha-segura-admin' },
  });
  assert.equal(adminLogin.status, 201);
  assert.deepEqual(adminLogin.payload.user.companies.map(({ id }) => id), ['1', '18', '19']);

  for (const account of [
    { email: 'oto@example.test', companyIds: ['1'] },
    { email: 'multi@example.test', companyIds: ['1', '18'] },
  ]) {
    const created = await api('/api/admin/users', {
      method: 'POST',
      cookie: adminLogin.cookie,
      body: { ...account, password: 'senha-segura-user', role: 'manager' },
    });
    assert.equal(created.status, 201);
  }

  const databasePath = path.join(dataRoot, 'HigiLeitoPro', 'users.json');
  const database = JSON.parse(await readFile(databasePath, 'utf8'));
  database.entities = {
    Bed: [
      { id: 'oto-bed', code: '101', company_id: '1', status: 'livre' },
      { id: 'gastro-bed', code: '201', company_id: '18', status: 'livre' },
      {
        id: 'gastro-review-bed',
        code: '202',
        company_id: '18',
        status: 'em_revisao',
        oracle_source: 'oracle',
        oracle_company_code: 18,
        oracle_cd_leito: '202',
      },
    ],
    CleaningTask: [
      { id: 'oto-task', company_id: '1', status: 'concluida', duration_seconds: 100 },
      { id: 'gastro-task', company_id: '18', status: 'concluida', duration_seconds: 200 },
      {
        id: 'gastro-review-task',
        company_id: '18',
        oracle_source: 'oracle',
        oracle_company_code: 18,
        bed_id: 'gastro-review-bed',
        status: 'em_andamento',
        mv_sync_status: 'erro',
        workflow_stage: 'revisao',
        revisao_started_at: new Date().toISOString(),
        requested_at: new Date(Date.now() - 60000).toISOString(),
        higienizacao_duration_seconds: 200,
        rouparia_duration_seconds: 100,
        revisao_duration_seconds: 0,
        idle_duration_seconds: 0,
      },
    ],
    Employee: [],
    Material: [],
    MaterialCheck: [],
    Unit: [],
  };
  await writeFile(databasePath, JSON.stringify(database));

  const oto = await login('oto@example.test', 'senha-segura-user');
  assert.deepEqual(oto.user.companies.map(({ id }) => id), ['1']);
  const otoBeds = await api('/api/entities/Bed/filter', {
    method: 'POST',
    cookie: oto.cookie,
    body: { query: {}, options: {} },
  });
  assert.deepEqual(otoBeds.payload.items.map(({ id }) => id), ['oto-bed']);

  const crossRead = await api('/api/entities/Bed/filter', {
    method: 'POST',
    cookie: oto.cookie,
    body: { query: { company_id: '18' }, options: {} },
  });
  assert.deepEqual(crossRead.payload.items, []);
  const crossWrite = await api('/api/entities/Bed/record/gastro-bed', {
    method: 'PATCH',
    cookie: oto.cookie,
    body: { status: 'em_limpeza' },
  });
  assert.equal(crossWrite.status, 404);
  const crossCreate = await api('/api/entities/Employee/create', {
    method: 'POST',
    cookie: oto.cookie,
    body: {
      name: 'Colaborador externo',
      registration: '999',
      function: 'higienizacao',
      company_id: '18',
    },
  });
  assert.equal(crossCreate.status, 403);
  const deniedSwitch = await api('/api/auth/switch-company', {
    method: 'POST',
    cookie: oto.cookie,
    body: { companyId: '18' },
  });
  assert.equal(deniedSwitch.status, 403);

  const multi = await login('multi@example.test', 'senha-segura-user');
  assert.equal(multi.user.activeCompanyId, '1');
  const gastroEmployee = await api('/api/entities/Employee/create', {
    method: 'POST',
    cookie: multi.cookie,
    body: {
      name: 'Colaborador Gastroclínica',
      registration: 'empresa-dupla',
      function: 'higienizacao',
      company_id: '18',
    },
  });
  assert.equal(gastroEmployee.status, 201);
  const duplicateGastroEmployee = await api('/api/entities/Employee/create', {
    method: 'POST',
    cookie: multi.cookie,
    body: {
      name: 'Matrícula duplicada',
      registration: 'empresa-dupla',
      function: 'higienizacao',
      company_id: '18',
    },
  });
  assert.equal(duplicateGastroEmployee.status, 409);
  const otoEmployeeWithSameRegistration = await api('/api/entities/Employee/create', {
    method: 'POST',
    cookie: multi.cookie,
    body: {
      name: 'Colaborador Otoclínica',
      registration: 'empresa-dupla',
      function: 'higienizacao',
      company_id: '1',
    },
  });
  assert.equal(otoEmployeeWithSameRegistration.status, 201);
  const otoAggregate = await api('/api/entities/CleaningTask/aggregate', {
    method: 'POST',
    cookie: multi.cookie,
    body: { query: { status: 'concluida' }, sum: ['duration_seconds'] },
  });
  assert.equal(otoAggregate.payload.rows[0].sum_duration_seconds, 100);

  const switched = await api('/api/auth/switch-company', {
    method: 'POST',
    cookie: multi.cookie,
    body: { companyId: '18' },
  });
  assert.equal(switched.status, 200);
  assert.equal(switched.payload.user.activeCompanyId, '18');
  const gastroBeds = await api('/api/entities/Bed/filter', {
    method: 'POST',
    cookie: multi.cookie,
    body: { query: {}, options: {} },
  });
  assert.deepEqual(gastroBeds.payload.items.map(({ id }) => id), ['gastro-bed', 'gastro-review-bed']);
  const unsafeRetry = await api('/api/workflow/complete-review', {
    method: 'POST',
    cookie: multi.cookie,
    body: { taskId: 'gastro-review-task' },
  });
  assert.equal(unsafeRetry.status, 409);
  assert.equal(unsafeRetry.payload.code, 'oracle_release_already_attempted');
  const approved = await api('/api/workflow/confirm-mv-release', {
    method: 'POST',
    cookie: multi.cookie,
    body: { taskId: 'gastro-review-task' },
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.payload.record.status, 'concluida');
  assert.equal(approved.payload.record.mv_sync_resolution, 'confirmacao_manual');
  const releasedBeds = await api('/api/entities/Bed/filter', {
    method: 'POST',
    cookie: multi.cookie,
    body: { query: { status: 'livre' }, options: {} },
  });
  assert.ok(releasedBeds.payload.items.some(({ id }) => id === 'gastro-review-bed'));

  const createdEmployee = await api('/api/entities/Employee/create', {
    method: 'POST',
    cookie: multi.cookie,
    body: {
      name: 'Colaborador São Mateus',
      registration: '2018',
      function: 'higienizacao',
      company_id: '18',
    },
  });
  assert.equal(createdEmployee.status, 201);
  assert.equal(createdEmployee.payload.record.company_id, '18');
});
