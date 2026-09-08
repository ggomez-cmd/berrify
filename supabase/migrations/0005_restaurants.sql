-- Restaurants under one org, each with its own QuickBooks company file.
-- Additive. Do not drop invoices.

create table if not exists public.restaurants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  qbo_company_name text not null,
  slug text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, slug)
);

create table if not exists public.restaurant_aliases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  match_kind text not null
    check (match_kind in ('whatsapp_group', 'whatsapp_from', 'caption', 'customer')),
  match_text text not null,
  unique (org_id, match_kind, match_text)
);

alter table public.invoices add column if not exists restaurant_id uuid
  references public.restaurants (id) on delete set null;
alter table public.invoices add column if not exists whatsapp_group text;

create index if not exists restaurants_org_id_idx on public.restaurants (org_id);
create index if not exists restaurant_aliases_restaurant_id_idx on public.restaurant_aliases (restaurant_id);
create index if not exists invoices_restaurant_id_idx on public.invoices (restaurant_id);

drop trigger if exists restaurants_set_updated_at on public.restaurants;
create trigger restaurants_set_updated_at
  before update on public.restaurants
  for each row execute function public.set_updated_at();

alter table public.restaurants enable row level security;
alter table public.restaurant_aliases enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'restaurants' and policyname = 'restaurants_all_member') then
    create policy restaurants_all_member on public.restaurants
      for all using (public.is_org_member(org_id))
      with check (public.is_org_member(org_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'restaurant_aliases' and policyname = 'restaurant_aliases_all_member') then
    create policy restaurant_aliases_all_member on public.restaurant_aliases
      for all using (public.is_org_member(org_id))
      with check (public.is_org_member(org_id));
  end if;
end
$$;

grant select, insert, update, delete on public.restaurants to authenticated;
grant select, insert, update, delete on public.restaurant_aliases to authenticated;
