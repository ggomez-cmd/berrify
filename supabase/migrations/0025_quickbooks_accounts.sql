-- QuickBooks account list (QBWC AccountQuery).
-- Additive. Apply with `npm run db:apply`, not db:push.
-- Does not drop invoice tables. Does not touch public.shifts or payroll.

create table if not exists public.quickbooks_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  connection_id uuid not null references public.quickbooks_desktop_connections (id) on delete cascade,
  list_id text not null,
  full_name text not null,
  account_number text,
  account_type text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, list_id)
);

create index if not exists quickbooks_accounts_org_id_idx
  on public.quickbooks_accounts (org_id);

create index if not exists quickbooks_accounts_connection_id_idx
  on public.quickbooks_accounts (connection_id);

drop trigger if exists quickbooks_accounts_set_updated_at on public.quickbooks_accounts;
create trigger quickbooks_accounts_set_updated_at
  before update on public.quickbooks_accounts
  for each row execute function public.set_updated_at();

alter table public.quickbooks_accounts enable row level security;

drop policy if exists quickbooks_accounts_manager on public.quickbooks_accounts;
create policy quickbooks_accounts_manager on public.quickbooks_accounts
  for all using (public.has_org_role(org_id, array['owner', 'manager']))
  with check (public.has_org_role(org_id, array['owner', 'manager']));

revoke all on public.quickbooks_accounts from public;
revoke all on public.quickbooks_accounts from authenticated;

grant select, insert, update, delete on public.quickbooks_accounts to authenticated;

grant all on public.quickbooks_accounts to service_role;
