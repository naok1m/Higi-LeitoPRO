-- Estrutura inicial do Higi Leito PRO no PostgreSQL.

create table users (
  id text primary key,
  seq bigint generated always as identity,
  email text not null unique,
  role text not null,
  company_ids text[] not null default '{}',
  active boolean not null default true,
  password_hash text not null,
  password_salt text not null,
  -- Campos extras do usuário (ex.: name) que não têm coluna própria.
  profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- O token do cookie nunca é gravado: guardamos apenas o SHA-256 dele.
create table sessions (
  token_hash text primary key,
  user_id text not null references users (id) on delete cascade,
  active_company_id text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user_id_idx on sessions (user_id);
create index sessions_expires_at_idx on sessions (expires_at);

create table password_reset_tokens (
  token_hash text primary key,
  user_id text not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index password_reset_tokens_user_id_idx on password_reset_tokens (user_id);

-- Leitos, unidades, colaboradores, materiais, conferências e processos de limpeza.
-- O registro completo fica em "data" (o mesmo formato que o frontend usa);
-- company_id e seq existem para filtrar por empresa e manter a ordem de criação.
create table entity_records (
  entity text not null,
  id text not null,
  seq bigint generated always as identity,
  company_id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (entity, id)
);
create index entity_records_company_idx on entity_records (entity, company_id, seq);
create index entity_records_status_idx on entity_records (entity, company_id, (data ->> 'status'));
create index entity_records_bed_idx on entity_records (entity, company_id, (data ->> 'bed_id'));

-- Trilha de auditoria de todas as alterações + fila de entrega do webhook.
create table change_events (
  id uuid primary key,
  event text not null,
  entity text,
  record_id text,
  company_id text,
  actor_id text,
  actor_email text,
  payload jsonb not null,
  occurred_at timestamptz not null,
  webhook_status text not null default 'skipped'
    check (webhook_status in ('pending', 'delivered', 'failed', 'skipped')),
  webhook_attempts integer not null default 0,
  webhook_next_attempt_at timestamptz,
  webhook_last_error text,
  webhook_delivered_at timestamptz
);
create index change_events_occurred_at_idx on change_events (occurred_at);
create index change_events_record_idx on change_events (entity, record_id);
create index change_events_webhook_pending_idx on change_events (webhook_next_attempt_at)
  where webhook_status = 'pending';

create table app_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
