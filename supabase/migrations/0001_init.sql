-- Berrify inventory MVP schema.
-- Idempotent: safe to re-run.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.memberships (
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'manager', 'staff')),
  created_at timestamptz not null default now(),
  primary key (user_id, org_id)
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  contact_email text,
  phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  sku text,
  category text,
  unit text not null default 'ea',
  quantity numeric not null default 0,
  reorder_level numeric not null default 0,
  unit_cost numeric not null default 0,
  supplier_id uuid references public.suppliers (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  item_id uuid not null references public.inventory_items (id) on delete cascade,
  delta numeric not null,
  reason text not null check (reason in ('purchase', 'usage', 'adjustment', 'waste')),
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists suppliers_org_id_idx on public.suppliers (org_id);
create index if not exists inventory_items_org_id_idx on public.inventory_items (org_id);
create index if not exists inventory_items_supplier_id_idx on public.inventory_items (supplier_id);
create index if not exists stock_movements_org_id_idx on public.stock_movements (org_id);
create index if not exists stock_movements_item_id_idx on public.stock_movements (item_id);
create index if not exists stock_movements_created_at_idx on public.stock_movements (created_at desc);
create index if not exists memberships_org_id_idx on public.memberships (org_id);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists suppliers_set_updated_at on public.suppliers;
create trigger suppliers_set_updated_at
  before update on public.suppliers
  for each row execute function public.set_updated_at();

drop trigger if exists inventory_items_set_updated_at on public.inventory_items;
create trigger inventory_items_set_updated_at
  before update on public.inventory_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Apply stock movements to item quantity
-- ---------------------------------------------------------------------------

create or replace function public.apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.inventory_items
  set quantity = quantity + new.delta
  where id = new.item_id
    and org_id = new.org_id;

  if not found then
    raise exception 'inventory item % not found in org %', new.item_id, new.org_id;
  end if;

  return new;
end;
$$;

drop trigger if exists stock_movements_apply on public.stock_movements;
create trigger stock_movements_apply
  after insert on public.stock_movements
  for each row execute function public.apply_stock_movement();

-- ---------------------------------------------------------------------------
-- Bootstrap an org + owner membership for every new auth user
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
  org_name text;
begin
  org_name := coalesce(
    new.raw_user_meta_data->>'org_name',
    split_part(coalesce(new.email, 'restaurant'), '@', 1) || '''s restaurant'
  );

  insert into public.organizations (name)
  values (org_name)
  returning id into new_org_id;

  insert into public.memberships (user_id, org_id, role)
  values (new.id, new_org_id, 'owner');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- RLS helpers and policies
-- ---------------------------------------------------------------------------

create or replace function public.is_org_member(check_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships
    where user_id = auth.uid()
      and org_id = check_org_id
  );
$$;

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.suppliers enable row level security;
alter table public.inventory_items enable row level security;
alter table public.stock_movements enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'organizations' and policyname = 'orgs_select_member') then
    create policy orgs_select_member on public.organizations
      for select using (public.is_org_member(id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'organizations' and policyname = 'orgs_update_member') then
    create policy orgs_update_member on public.organizations
      for update using (public.is_org_member(id))
      with check (public.is_org_member(id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'memberships' and policyname = 'memberships_select_own') then
    create policy memberships_select_own on public.memberships
      for select using (user_id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'suppliers' and policyname = 'suppliers_all_member') then
    create policy suppliers_all_member on public.suppliers
      for all using (public.is_org_member(org_id))
      with check (public.is_org_member(org_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'inventory_items' and policyname = 'inventory_items_all_member') then
    create policy inventory_items_all_member on public.inventory_items
      for all using (public.is_org_member(org_id))
      with check (public.is_org_member(org_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stock_movements' and policyname = 'stock_movements_select_member') then
    create policy stock_movements_select_member on public.stock_movements
      for select using (public.is_org_member(org_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stock_movements' and policyname = 'stock_movements_insert_member') then
    create policy stock_movements_insert_member on public.stock_movements
      for insert with check (public.is_org_member(org_id));
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated;

grant select, update on public.organizations to authenticated;
grant select on public.memberships to authenticated;
grant select, insert, update, delete on public.suppliers to authenticated;
grant select, insert, update, delete on public.inventory_items to authenticated;
grant select, insert on public.stock_movements to authenticated;
