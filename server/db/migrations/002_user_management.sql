alter table users
  add column last_login timestamptz,
  add column must_change_password boolean not null default false;

create table user_audit_events (
  id uuid primary key,
  user_id text not null references users (id) on delete cascade,
  actor_id text not null,
  actor_email text not null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index user_audit_events_user_time_idx on user_audit_events (user_id, occurred_at desc);
