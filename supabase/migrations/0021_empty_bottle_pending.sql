-- Durable Telegram /empty pending flag (Worker isolates do not share memory).
-- Additive. Apply with `npm run db:apply`, not db:push.

create table if not exists public.empty_bottle_pending (
  org_id uuid not null references public.organizations (id) on delete cascade,
  chat_id text not null,
  hint text not null default '',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (org_id, chat_id)
);

create index if not exists empty_bottle_pending_expires_at_idx
  on public.empty_bottle_pending (expires_at);

alter table public.empty_bottle_pending enable row level security;

revoke all on public.empty_bottle_pending from public;
revoke all on public.empty_bottle_pending from authenticated;
grant all on public.empty_bottle_pending to service_role;
