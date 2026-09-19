-- QuickBooks Web Connector sessions, credentials, and sync jobs.
-- Additive. Apply with `npm run db:apply`, not db:push.
-- Does not drop invoice tables. Does not touch public.shifts or payroll.

create table if not exists public.quickbooks_desktop_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  restaurant_id uuid references public.restaurants (id) on delete set null,
  name text not null,
  qb_username text not null,
  password_hash text not null,
  owner_id uuid not null default gen_random_uuid(),
  file_id uuid not null default gen_random_uuid(),
  company_file text,
  qb_company_name text,
  qb_product_name text,
  qb_major_version text,
  qb_minor_version text,
  is_active boolean not null default true,
  last_connected_at timestamptz,
  last_successful_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, qb_username)
);

create unique index if not exists quickbooks_desktop_connections_org_restaurant_uidx
  on public.quickbooks_desktop_connections (org_id, restaurant_id)
  where restaurant_id is not null;

create unique index if not exists quickbooks_desktop_connections_org_shared_uidx
  on public.quickbooks_desktop_connections (org_id)
  where restaurant_id is null;

create index if not exists quickbooks_desktop_connections_org_id_idx
  on public.quickbooks_desktop_connections (org_id);

create table if not exists public.quickbooks_desktop_sessions (
  ticket text primary key,
  connection_id uuid not null references public.quickbooks_desktop_connections (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  expires_at timestamptz not null,
  last_error text,
  created_at timestamptz not null default now()
);

create index if not exists quickbooks_desktop_sessions_connection_id_idx
  on public.quickbooks_desktop_sessions (connection_id);

create index if not exists quickbooks_desktop_sessions_expires_at_idx
  on public.quickbooks_desktop_sessions (expires_at);

create table if not exists public.quickbooks_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  connection_id uuid not null references public.quickbooks_desktop_connections (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'completed', 'failed')),
  operation text not null,
  entity_type text not null,
  entity_id text not null,
  attempt_count int not null default 0,
  qbxml_request text,
  qbxml_response text,
  quickbooks_txn_id text,
  edit_sequence text,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quickbooks_sync_jobs_idempotency_key
    unique (connection_id, entity_type, entity_id, operation)
);

create index if not exists quickbooks_sync_jobs_connection_status_idx
  on public.quickbooks_sync_jobs (connection_id, status);

drop trigger if exists quickbooks_desktop_connections_set_updated_at on public.quickbooks_desktop_connections;
create trigger quickbooks_desktop_connections_set_updated_at
  before update on public.quickbooks_desktop_connections
  for each row execute function public.set_updated_at();

drop trigger if exists quickbooks_sync_jobs_set_updated_at on public.quickbooks_sync_jobs;
create trigger quickbooks_sync_jobs_set_updated_at
  before update on public.quickbooks_sync_jobs
  for each row execute function public.set_updated_at();

alter table public.quickbooks_desktop_connections enable row level security;
alter table public.quickbooks_desktop_sessions enable row level security;
alter table public.quickbooks_sync_jobs enable row level security;

drop policy if exists quickbooks_desktop_connections_select_manager on public.quickbooks_desktop_connections;
create policy quickbooks_desktop_connections_select_manager on public.quickbooks_desktop_connections
  for select using (public.has_org_role(org_id, array['owner', 'manager']));

drop policy if exists quickbooks_sync_jobs_select_manager on public.quickbooks_sync_jobs;
create policy quickbooks_sync_jobs_select_manager on public.quickbooks_sync_jobs
  for select using (public.has_org_role(org_id, array['owner', 'manager']));

revoke all on public.quickbooks_desktop_connections from public;
revoke all on public.quickbooks_desktop_connections from authenticated;
revoke all on public.quickbooks_desktop_sessions from public;
revoke all on public.quickbooks_desktop_sessions from authenticated;
revoke all on public.quickbooks_sync_jobs from public;
revoke all on public.quickbooks_sync_jobs from authenticated;

grant select (
  id,
  org_id,
  restaurant_id,
  name,
  qb_username,
  owner_id,
  file_id,
  company_file,
  qb_company_name,
  qb_product_name,
  qb_major_version,
  qb_minor_version,
  is_active,
  last_connected_at,
  last_successful_sync_at,
  last_error,
  created_at,
  updated_at
) on public.quickbooks_desktop_connections to authenticated;

grant select on public.quickbooks_sync_jobs to authenticated;

grant all on public.quickbooks_desktop_connections to service_role;
grant all on public.quickbooks_desktop_sessions to service_role;
grant all on public.quickbooks_sync_jobs to service_role;
