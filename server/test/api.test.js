import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { createApiClient, startTestDatabase } from './helpers.js';

const database = await startTestDatabase();
process.env.HIGI_SKIP_ENV_FILE = '1';
process.env.DATABASE_URL = database.url;
process.env.HIGI_ADMIN_EMAIL = 'ti@example.test';

// Recebe os webhooks durante o teste; a primeira entrega falha de propósito.
const webhookDeliveries = [];
let failNextWebhook = true;
const webhookServer = createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    if (failNextWebhook) {
      failNextWebhook = false;
      response.writeHead(500).end();
      return;
    }
    webhookDeliveries.push({ headers: request.headers, body: Buffer.concat(chunks).toString('utf8') });
    response.writeHead(204).end();
  });
});
await new Promise((resolve) => webhookServer.listen(0, '127.0.0.1', resolve));
process.env.HIGI_WEBHOOK_URL = `http://127.0.0.1:${webhookServer.address().port}/hook`;
process.env.HIGI_WEBHOOK_SECRET = 'segredo-de-teste';

const { apiHandler } = await import('../app.js');
const { runMigrations } = await import('../db/migrate.js');
const { closePool, query, withTransaction } = await import('../db/pool.js');
const { insertEntityRecords, readEntities, updateEntities } = await import('../db/entityStore.js');
const { dispatchPendingWebhooks } = await import('../services/webhookDispatcher.js');
const { upsertOracleCleaningBeds } = await import('../services/oracleSync.js');

const server = createServer((request, response) => apiHandler(request, response, () => {
  response.writeHead(404).end();
}));

before(async () => {
  await runMigrations();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => webhookServer.close(resolve));
  await closePool();
  await database.stop();
});

const api = (...args) => createApiClient(`http://127.0.0.1:${server.address().port}`)(...args);

const seedEntities = (entities) => withTransaction(async (client) => {
  for (const [entity, records] of Object.entries(entities)) {
    await insertEntityRecords(client, entity, records);
  }
});

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
    { name: 'Otoclínica Gestor', email: 'oto@example.test', companyIds: ['1'] },
    { name: 'Gestor Multiempresa', email: 'multi@example.test', companyIds: ['1', '18'] },
  ]) {
    const created = await api('/api/admin/users', {
      method: 'POST',
      cookie: adminLogin.cookie,
      body: { ...account, password: 'senha-segura-user', role: 'manager' },
    });
    assert.equal(created.status, 201);
  }

  const seed = {
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
  await seedEntities(seed);

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

test('manages users with filters, temporary password changes, status and audit history', async () => {
  const admin = await login('ti@example.test', 'senha-segura-admin');
  const listed = await api('/api/admin/users?search=oto&role=manager&status=active&companyId=1&page=1&pageSize=10', {
    cookie: admin.cookie,
  });
  assert.equal(listed.status, 200);
  assert.equal(listed.payload.pagination.total, 1);
  assert.equal(listed.payload.users[0].name, 'Otoclínica Gestor');
  assert.ok(listed.payload.users[0].lastLogin);

  const generatedAccount = await api('/api/admin/users', {
    method: 'POST',
    cookie: admin.cookie,
    body: { name: 'Conta com senha gerada', email: 'gerada@example.test', role: 'manager', companyIds: ['1'] },
  });
  assert.equal(generatedAccount.status, 201);
  assert.equal(generatedAccount.payload.user.mustChangePassword, true);
  assert.ok(generatedAccount.payload.temporaryPassword);

  const allUsers = await api('/api/admin/users?search=&page=1&pageSize=25', { cookie: admin.cookie });
  const primaryAdmin = allUsers.payload.users.find((user) => user.isPrimaryAdmin);
  assert.ok(primaryAdmin);
  const lockedEmail = await api(`/api/admin/users/${primaryAdmin.id}`, {
    method: 'PATCH',
    cookie: admin.cookie,
    body: { email: 'other-admin@example.test' },
  });
  assert.equal(lockedEmail.status, 409);
  assert.equal(lockedEmail.payload.code, 'primary_admin_email_locked');

  const account = listed.payload.users[0];
  const editResponse = await api(`/api/admin/users/${account.id}`, {
    method: 'PATCH',
    cookie: admin.cookie,
    body: {
      name: 'Gestora Atualizada',
      email: 'gestora-atualizada@example.test',
      registration: '12345678900',
      role: 'manager',
      companyIds: ['1', '18'],
      active: true,
    },
  });
  assert.equal(editResponse.status, 200);
  assert.equal(editResponse.payload.user.name, 'Gestora Atualizada');
  assert.equal(editResponse.payload.user.email, 'gestora-atualizada@example.test');
  assert.equal(editResponse.payload.user.registration, '12345678900');
  assert.deepEqual(editResponse.payload.user.companyIds, ['1', '18']);
  const editedAccount = editResponse.payload.user;
  const oldSession = await login(editedAccount.email, 'senha-segura-user');
  const reset = await api(`/api/admin/users/${editedAccount.id}/reset-password`, {
    method: 'PATCH',
    cookie: admin.cookie,
    body: {},
  });
  assert.equal(reset.status, 200);
  assert.equal(reset.payload.user.mustChangePassword, true);
  assert.ok(reset.payload.temporaryPassword);
  assert.equal((await api('/api/auth/me', { cookie: oldSession.cookie })).payload.user, null);

  const temporaryLogin = await login(editedAccount.email, reset.payload.temporaryPassword);
  assert.equal(temporaryLogin.user.mustChangePassword, true);
  const blockedRequest = await api('/api/entities/Bed/filter', {
    method: 'POST',
    cookie: temporaryLogin.cookie,
    body: { query: {}, options: {} },
  });
  assert.equal(blockedRequest.status, 403);
  assert.equal(blockedRequest.payload.code, 'password_change_required');
  const weakPassword = await api('/api/auth/change-temporary-password', {
    method: 'POST',
    cookie: temporaryLogin.cookie,
    body: { newPassword: 'weak' },
  });
  assert.equal(weakPassword.status, 400);
  const changedPassword = await api('/api/auth/change-temporary-password', {
    method: 'POST',
    cookie: temporaryLogin.cookie,
    body: { newPassword: 'Hosp!talSecure2026' },
  });
  assert.equal(changedPassword.status, 200);
  const allowedRequest = await api('/api/entities/Bed/filter', {
    method: 'POST',
    cookie: temporaryLogin.cookie,
    body: { query: {}, options: {} },
  });
  assert.equal(allowedRequest.status, 200);

  const audit = await api(`/api/admin/users/${editedAccount.id}/audit`, { cookie: admin.cookie });
  assert.equal(audit.status, 200);
  assert.deepEqual(audit.payload.events.map(({ action }) => action), [
    'password_changed',
    'password_reset',
    'updated',
    'created',
  ]);

  const deactivated = await api(`/api/admin/users/${editedAccount.id}/status`, {
    method: 'PATCH',
    cookie: admin.cookie,
    body: { active: false },
  });
  assert.equal(deactivated.status, 200);
  assert.equal(deactivated.payload.user.active, false);
  const inactiveLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { email: editedAccount.email, password: 'Hosp!talSecure2026' },
  });
  assert.equal(inactiveLogin.status, 403);
  const reactivated = await api(`/api/admin/users/${editedAccount.id}/status`, {
    method: 'PATCH',
    cookie: admin.cookie,
    body: { active: true },
  });
  assert.equal(reactivated.status, 200);
  assert.equal(reactivated.payload.user.active, true);
});

test('stores only hashed session tokens and ends sessions on logout', async () => {
  const admin = await login('ti@example.test', 'senha-segura-admin');
  const rawToken = admin.cookie.split('=')[1];
  const { rows } = await query('select token_hash from sessions');
  assert.ok(rows.length > 0);
  assert.ok(rows.every(({ token_hash: tokenHash }) => tokenHash !== rawToken));

  const me = await api('/api/auth/me', { cookie: admin.cookie });
  assert.equal(me.payload.user.email, 'ti@example.test');
  await api('/api/auth/logout', { method: 'POST', body: {}, cookie: admin.cookie });
  const afterLogout = await api('/api/auth/me', { cookie: admin.cookie });
  assert.equal(afterLogout.payload.user, null);
});

test('completes active tasks manually through the workflow API route', async () => {
  const admin = await login('ti@example.test', 'senha-segura-admin');
  const idleLimit = await api('/api/workflow/idle-limit', { cookie: admin.cookie });
  assert.equal(idleLimit.status, 200);
  assert.equal(idleLimit.payload.idleLimitMinutes, 180);
  assert.equal(idleLimit.payload.operationLimitMinutes, 360);
  const savedLimits = await api('/api/workflow/idle-limit', {
    method: 'PUT',
    cookie: admin.cookie,
    body: { idleLimitMinutes: 90, operationLimitMinutes: 240 },
  });
  assert.equal(savedLimits.status, 200);
  assert.equal(savedLimits.payload.idleLimitMinutes, 90);
  assert.equal(savedLimits.payload.operationLimitMinutes, 240);

  await seedEntities({
    Bed: [{ id: 'manual-bed', company_id: '1', status: 'em_limpeza' }],
    CleaningTask: [{
      id: 'manual-task',
      company_id: '1',
      bed_id: 'manual-bed',
      bed_code: '101',
      status: 'em_andamento',
      workflow_stage: 'higienizacao',
      started_at: new Date(Date.now() - 60000).toISOString(),
      requested_at: new Date(Date.now() - 120000).toISOString(),
    }],
  });

  const completion = await api('/api/workflow/complete-manual', {
    method: 'POST',
    cookie: admin.cookie,
    body: { taskId: 'manual-task', reason: 'Conclusão validada pela liderança' },
  });

  assert.equal(completion.status, 200);
  assert.equal(completion.payload.manuallyCompleted, true);
  assert.equal(completion.payload.record.status, 'concluida');
  assert.equal(completion.payload.record.manual_completion_reason, 'Conclusão validada pela liderança');
  const beds = await api('/api/entities/Bed/filter', {
    method: 'POST',
    cookie: admin.cookie,
    body: { query: { id: 'manual-bed' }, options: {} },
  });
  assert.equal(beds.payload.items[0].status, 'livre');
});

test('runs the collaborator cleaning flow on scoped database operations', async () => {
  const admin = await login('ti@example.test', 'senha-segura-admin');
  const createdUser = await api('/api/admin/users', {
    method: 'POST',
    cookie: admin.cookie,
    body: { name: 'Maria Colaboradora', email: 'colab@example.test', password: 'senha-colab', role: 'collaborator', companyIds: ['19'] },
  });
  assert.equal(createdUser.status, 201);
  await api('/api/auth/switch-company', { method: 'POST', cookie: admin.cookie, body: { companyId: '19' } });
  const employee = await api('/api/entities/Employee/create', {
    method: 'POST',
    cookie: admin.cookie,
    body: { name: 'Maria', registration: 'sm-1', function: 'higienizacao', company_id: '19' },
  });
  assert.equal(employee.status, 201);
  await seedEntities({
    Bed: [{
      id: 'sm-bed',
      code: '301',
      company_id: '19',
      status: 'aguardando_limpeza',
      updated_date: new Date(Date.now() - 120000).toISOString(),
    }],
    CleaningTask: [{ id: 'sm-old-task', company_id: '19', bed_id: 'other', status: 'concluida' }],
  });

  const collaborator = await login('colab@example.test', 'senha-colab');
  const queue = await api('/api/entities/Bed/filter', {
    method: 'POST',
    cookie: collaborator.cookie,
    body: { query: { status: 'aguardando_limpeza' }, options: {} },
  });
  assert.deepEqual(queue.payload.items.map(({ id }) => id), ['sm-bed']);

  const taskValues = {
    bed_id: 'sm-bed',
    employee_id: employee.payload.record.id,
    cleaning_type: 'terminal',
    status: 'em_andamento',
    started_at: new Date().toISOString(),
  };
  const task = await api('/api/entities/CleaningTask/create', { method: 'POST', cookie: collaborator.cookie, body: taskValues });
  assert.equal(task.status, 201);
  assert.equal(task.payload.record.workflow_stage, 'higienizacao');
  assert.equal(task.payload.record.employee_name, 'Maria');
  assert.ok(task.payload.record.higienizacao_idle_seconds >= 119);
  const duplicate = await api('/api/entities/CleaningTask/create', { method: 'POST', cookie: collaborator.cookie, body: taskValues });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.payload.code, 'employee_has_active_task');

  const bedUpdate = await api('/api/entities/Bed/record/sm-bed', {
    method: 'PATCH',
    cookie: collaborator.cookie,
    body: { status: 'em_limpeza' },
  });
  assert.equal(bedUpdate.status, 200);
  const toLinen = await api(`/api/entities/CleaningTask/record/${task.payload.record.id}`, {
    method: 'PATCH',
    cookie: collaborator.cookie,
    body: { workflow_stage: 'rouparia' },
  });
  assert.equal(toLinen.status, 200);
  assert.ok(toLinen.payload.record.higienizacao_finished_at);

  const active = await api('/api/entities/CleaningTask/filter', {
    method: 'POST',
    cookie: collaborator.cookie,
    body: { query: { status: 'em_andamento', workflow_stage: 'rouparia' }, options: {} },
  });
  assert.deepEqual(active.payload.items.map(({ id }) => id), [task.payload.record.id]);

  const history = await api('/api/entities/CleaningTask/filter', {
    method: 'POST',
    cookie: admin.cookie,
    body: { query: {}, options: { sort: '-created_date' } },
  });
  assert.deepEqual(new Set(history.payload.items.map(({ id }) => id)), new Set([task.payload.record.id, 'sm-old-task']));

  const { rows } = await query(
    "select actor_email from change_events where event = 'entity.created' and record_id = $1",
    [task.payload.record.id],
  );
  assert.deepEqual(rows, [{ actor_email: 'colab@example.test' }]);
});

test('restricts Oracle discharge and ad-hoc endpoints to authenticated leaders', async () => {
  const anonymousForecast = await api('/api/oracle/discharge-forecast');
  assert.equal(anonymousForecast.status, 401);
  const anonymousRequest = await api('/api/oracle/ad-hoc-cleaning', {
    method: 'POST',
    body: { bedId: 'oracle-bed-1-501' },
  });
  assert.equal(anonymousRequest.status, 401);

  const collaborator = await login('colab@example.test', 'senha-colab');
  const collaboratorForecast = await api('/api/oracle/discharge-forecast', { cookie: collaborator.cookie });
  assert.equal(collaboratorForecast.status, 403);
  const collaboratorRequest = await api('/api/oracle/ad-hoc-cleaning', {
    method: 'POST',
    cookie: collaborator.cookie,
    body: { bedId: 'oracle-bed-1-501', cleaningType: 1, observation: '' },
  });
  assert.equal(collaboratorRequest.status, 403);
});

test('imports and updates Oracle beds only when the MV data changes', async () => {
  const rows = [{
    CD_LEITO: 501,
    DS_LEITO: '501A',
    CD_UNID_INT: 7,
    UNIDADE_INTERNACAO: 'Posto 7',
    CD_SOLIC_LIMPEZA: 9001,
    DH_SOLICITACAO: new Date('2026-10-20T10:00:00Z'),
    DS_TIPO_LIMPEZA: 'Terminal',
  }];
  assert.deepEqual(await upsertOracleCleaningBeds(rows, 1), { imported: 1, updated: 0 });
  assert.equal(await upsertOracleCleaningBeds(rows, 1), null);
  assert.deepEqual(
    await upsertOracleCleaningBeds([{ ...rows[0], CD_SOLIC_LIMPEZA: 9002 }], 1),
    { imported: 0, updated: 1 },
  );
  const database = await readEntities({ entities: ['Bed', 'Unit'], companyId: '1' });
  const bed = database.entities.Bed.find(({ id }) => id === 'oracle-bed-1-501');
  assert.equal(bed.oracle_request_id, '9002');
  assert.equal(bed.status, 'aguardando_limpeza');
  assert.ok(database.entities.Unit.some(({ id }) => id === 'oracle-unit-1-7'));
});

test('refuses to touch entities outside the loaded scope', async () => {
  await assert.rejects(
    updateEntities({ entities: ['Bed'], companyId: '1' }, (database) => database.entities.CleaningTask),
    /não foi carregada/,
  );
  await seedEntities({ MaterialCheck: [{ id: 'mc-1', company_id: '1' }, { id: 'mc-2', company_id: '1' }] });
  await updateEntities(
    { entities: ['MaterialCheck'], companyId: '1', filters: { MaterialCheck: [{ id: 'mc-1' }] } },
    (database) => { database.entities.MaterialCheck = []; },
  );
  const remaining = await readEntities({ entities: ['MaterialCheck'], companyId: '1' });
  assert.deepEqual(remaining.entities.MaterialCheck.map(({ id }) => id), ['mc-2']);
});

test('delivers signed webhooks from the outbox and retries failures', async () => {
  const pendingCount = async () =>
    (await query("select count(*)::int as total from change_events where webhook_status = 'pending'")).rows[0].total;
  assert.ok(await pendingCount() > 0);

  await dispatchPendingWebhooks();
  const { rows: retrying } = await query(
    'select webhook_attempts, webhook_next_attempt_at > now() as waiting from change_events where webhook_last_error is not null',
  );
  assert.deepEqual(retrying, [{ webhook_attempts: 1, waiting: true }]);

  for (let round = 0; round < 10 && await pendingCount() > 0; round += 1) {
    await query("update change_events set webhook_next_attempt_at = now() where webhook_status = 'pending'");
    await dispatchPendingWebhooks();
  }
  assert.equal(await pendingCount(), 0);
  const { rows: undelivered } = await query("select count(*)::int as total from change_events where webhook_status <> 'delivered'");
  assert.equal(undelivered[0].total, 0);

  const delivery = webhookDeliveries[0];
  const expected = `sha256=${createHmac('sha256', 'segredo-de-teste').update(delivery.body).digest('hex')}`;
  assert.equal(delivery.headers['x-higi-signature'], expected);
  assert.equal(JSON.parse(delivery.body).source, 'higi-leito-pro');
});
