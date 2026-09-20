-- QuickBooks vendor list (QBWC VendorQuery) and extra invoice pages.
-- Additive. Apply with `npm run db:apply`, not db:push.
-- Does not drop invoice tables. Does not touch public.shifts or payroll.

create table if not exists public.quickbooks_vendors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  connection_id uuid not null references public.quickbooks_desktop_connections (id) on delete cascade,
  list_id text not null,
  full_name text not null,
  company_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, list_id)
);

create index if not exists quickbooks_vendors_org_id_idx
  on public.quickbooks_vendors (org_id);

create index if not exists quickbooks_vendors_connection_id_idx
  on public.quickbooks_vendors (connection_id);

create table if not exists public.invoice_pages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  sort_order int not null,
  image_data text,
  image_mime text,
  created_at timestamptz not null default now(),
  unique (invoice_id, sort_order)
);

create index if not exists invoice_pages_invoice_id_idx
  on public.invoice_pages (invoice_id);

alter table public.invoices
  add column if not exists telegram_media_group_id text;

drop trigger if exists quickbooks_vendors_set_updated_at on public.quickbooks_vendors;
create trigger quickbooks_vendors_set_updated_at
  before update on public.quickbooks_vendors
  for each row execute function public.set_updated_at();

alter table public.quickbooks_vendors enable row level security;
alter table public.invoice_pages enable row level security;

drop policy if exists quickbooks_vendors_manager on public.quickbooks_vendors;
create policy quickbooks_vendors_manager on public.quickbooks_vendors
  for all using (public.has_org_role(org_id, array['owner', 'manager']))
  with check (public.has_org_role(org_id, array['owner', 'manager']));

drop policy if exists invoice_pages_manager on public.invoice_pages;
create policy invoice_pages_manager on public.invoice_pages
  for all using (public.has_org_role(org_id, array['owner', 'manager']))
  with check (public.has_org_role(org_id, array['owner', 'manager']));

revoke all on public.quickbooks_vendors from public;
revoke all on public.quickbooks_vendors from authenticated;
revoke all on public.invoice_pages from public;
revoke all on public.invoice_pages from authenticated;

grant select, insert, update, delete on public.quickbooks_vendors to authenticated;
grant select, insert, update, delete on public.invoice_pages to authenticated;

grant all on public.quickbooks_vendors to service_role;
grant all on public.invoice_pages to service_role;
