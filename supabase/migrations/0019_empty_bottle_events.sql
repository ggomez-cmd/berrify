-- Telegram empty-bottle confirm-then-debit events. Additive. Apply with `npm run db:apply`, not db:push.

create table if not exists public.empty_bottle_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  telegram_message_id text not null,
  chat_id text not null,
  restaurant_id uuid references public.restaurants (id) on delete set null,
  proposed_item_id uuid not null references public.inventory_items (id) on delete restrict,
  proposed_label text not null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'cancelled')),
  created_at timestamptz not null default now()
);

create unique index if not exists empty_bottle_events_org_telegram_message_uidx
  on public.empty_bottle_events (org_id, telegram_message_id);

create index if not exists empty_bottle_events_org_id_idx
  on public.empty_bottle_events (org_id);

create index if not exists empty_bottle_events_status_idx
  on public.empty_bottle_events (org_id, status);

alter table public.empty_bottle_events enable row level security;

drop policy if exists empty_bottle_events_select_manager on public.empty_bottle_events;
create policy empty_bottle_events_select_manager on public.empty_bottle_events
  for select using (public.has_org_role(org_id, array['admin', 'manager']));

grant select on public.empty_bottle_events to authenticated;

-- Generic empty-bottle catalog (qty 12). Skip SKUs that already exist per org.
insert into public.inventory_items (
  org_id,
  name,
  sku,
  category,
  unit,
  quantity,
  reorder_level,
  unit_cost
)
select
  org.id,
  seed.name,
  seed.sku,
  'Beverages',
  'bottle',
  12,
  4,
  0
from public.organizations org
cross join (
  values
    ('BV-EB-RUM', 'Rum'),
    ('BV-EB-VODKA', 'Vodka'),
    ('BV-EB-GIN', 'Gin'),
    ('BV-EB-TEQUILA', 'Tequila'),
    ('BV-EB-WHISKY', 'Whisky'),
    ('BV-EB-BEER', 'Beer'),
    ('BV-EB-WINE', 'Wine'),
    ('BV-EB-UNKNOWN', 'Unknown liquor')
) as seed(sku, name)
where not exists (
  select 1
  from public.inventory_items existing
  where existing.org_id = org.id
    and existing.sku = seed.sku
);
