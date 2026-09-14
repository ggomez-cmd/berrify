-- SKU / expense aliases learned from Invoice Review so Gemini extract
-- can reuse corrected accounts. Additive. Manager-only, same as vendor_aliases.

create table if not exists public.invoice_sku_aliases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  match_text text not null,
  account text not null,
  memo text,
  category text not null default 'other'
    check (category in ('food', 'kitchen', 'cleaning', 'tax', 'other', 'beverage'))
);

create unique index if not exists invoice_sku_aliases_org_match_idx
  on public.invoice_sku_aliases (org_id, match_text);

alter table public.invoice_sku_aliases enable row level security;

drop policy if exists invoice_sku_aliases_manager on public.invoice_sku_aliases;
create policy invoice_sku_aliases_manager on public.invoice_sku_aliases
  for all using (public.has_org_role(org_id, array['owner', 'manager']))
  with check (public.has_org_role(org_id, array['owner', 'manager']));

grant select, insert, update, delete on public.invoice_sku_aliases to authenticated;
