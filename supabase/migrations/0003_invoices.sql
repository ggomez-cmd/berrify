-- Supplier invoice capture → QuickBooks Desktop Bill (Expenses tab).
-- Idempotent. Drops the earlier draft invoice tables if they exist.

drop table if exists public.invoice_lines cascade;
drop table if exists public.invoice_expense_lines cascade;
drop table if exists public.vendor_aliases cascade;
drop table if exists public.account_rules cascade;
drop table if exists public.invoices cascade;

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  supplier_id uuid references public.suppliers (id) on delete set null,
  vendor_name text,
  invoice_number text,
  invoice_date date,
  due_date date,
  terms text not null default 'Net 15',
  currency text not null default 'USD',
  subtotal numeric not null default 0,
  tax numeric not null default 0,
  total numeric not null default 0,
  ap_account text not null default '20000 · Accounts payable',
  status text not null default 'received'
    check (status in ('received', 'extracted', 'reviewed', 'exported')),
  source text not null default 'upload'
    check (source in ('upload', 'whatsapp', 'camera')),
  whatsapp_from text,
  whatsapp_message_id text,
  caption text,
  image_data text,
  image_mime text,
  ocr_text text,
  created_by uuid references auth.users (id) on delete set null,
  exported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  code text,
  description text not null,
  qty_ordered numeric not null default 0,
  qty_shipped numeric not null default 0,
  uom text,
  pounds numeric,
  unit_price numeric not null default 0,
  amount numeric not null default 0,
  category text not null default 'food'
    check (category in ('food', 'kitchen', 'cleaning', 'tax', 'other')),
  created_at timestamptz not null default now()
);

create table public.invoice_expense_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  account text not null,
  amount numeric not null default 0,
  memo text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.vendor_aliases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  match_text text not null,
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  qbo_vendor_name text not null
);

create table public.account_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  keyword text not null,
  account text not null,
  memo text,
  category text not null default 'other'
    check (category in ('food', 'kitchen', 'cleaning', 'tax', 'other'))
);

create index invoices_org_id_idx on public.invoices (org_id);
create index invoice_lines_invoice_id_idx on public.invoice_lines (invoice_id);
create index invoice_expense_lines_invoice_id_idx on public.invoice_expense_lines (invoice_id);
create unique index vendor_aliases_org_match_idx on public.vendor_aliases (org_id, match_text);
create unique index account_rules_org_keyword_idx on public.account_rules (org_id, keyword);

drop trigger if exists invoices_set_updated_at on public.invoices;
create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.invoice_expense_lines enable row level security;
alter table public.vendor_aliases enable row level security;
alter table public.account_rules enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invoices' and policyname = 'invoices_all_member') then
    create policy invoices_all_member on public.invoices
      for all using (public.is_org_member(org_id))
      with check (public.is_org_member(org_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invoice_lines' and policyname = 'invoice_lines_all_member') then
    create policy invoice_lines_all_member on public.invoice_lines
      for all using (public.is_org_member(org_id))
      with check (public.is_org_member(org_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invoice_expense_lines' and policyname = 'invoice_expenses_all_member') then
    create policy invoice_expenses_all_member on public.invoice_expense_lines
      for all using (public.is_org_member(org_id))
      with check (public.is_org_member(org_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vendor_aliases' and policyname = 'vendor_aliases_all_member') then
    create policy vendor_aliases_all_member on public.vendor_aliases
      for all using (public.is_org_member(org_id))
      with check (public.is_org_member(org_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'account_rules' and policyname = 'account_rules_all_member') then
    create policy account_rules_all_member on public.account_rules
      for all using (public.is_org_member(org_id))
      with check (public.is_org_member(org_id));
  end if;
end
$$;

grant select, insert, update, delete on public.invoices to authenticated;
grant select, insert, update, delete on public.invoice_lines to authenticated;
grant select, insert, update, delete on public.invoice_expense_lines to authenticated;
grant select, insert, update, delete on public.vendor_aliases to authenticated;
grant select, insert, update, delete on public.account_rules to authenticated;
