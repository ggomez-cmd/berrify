-- Review-corrected invoice examples (OCR snippet + JSON) for Gemini extract.
-- Additive. Manager-only, same as invoices. Apply with `npm run db:apply`, not db:push.

create table if not exists public.invoice_extract_examples (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  invoice_id uuid not null unique references public.invoices (id) on delete cascade,
  supplier_id uuid references public.suppliers (id) on delete set null,
  restaurant_id uuid references public.restaurants (id) on delete set null,
  ocr_snippet text not null,
  corrected jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists invoice_extract_examples_org_id_idx
  on public.invoice_extract_examples (org_id);
create index if not exists invoice_extract_examples_org_supplier_idx
  on public.invoice_extract_examples (org_id, supplier_id);
create index if not exists invoice_extract_examples_org_restaurant_idx
  on public.invoice_extract_examples (org_id, restaurant_id);

drop trigger if exists invoice_extract_examples_set_updated_at on public.invoice_extract_examples;
create trigger invoice_extract_examples_set_updated_at
  before update on public.invoice_extract_examples
  for each row execute function public.set_updated_at();

alter table public.invoice_extract_examples enable row level security;

drop policy if exists invoice_extract_examples_manager on public.invoice_extract_examples;
create policy invoice_extract_examples_manager on public.invoice_extract_examples
  for all using (public.has_org_role(org_id, array['owner', 'manager']))
  with check (public.has_org_role(org_id, array['owner', 'manager']));

grant select, insert, update, delete on public.invoice_extract_examples to authenticated;

insert into public.invoice_extract_examples (
  org_id,
  invoice_id,
  supplier_id,
  restaurant_id,
  ocr_snippet,
  corrected
)
select
  i.org_id,
  i.id,
  i.supplier_id,
  i.restaurant_id,
  left(i.ocr_text, 5000),
  jsonb_build_object(
    'vendor_name', i.vendor_name,
    'invoice_number', i.invoice_number,
    'invoice_date', i.invoice_date,
    'total', i.total,
    'qbo_vendor_name', coalesce(s.name, i.vendor_name),
    'supplier_id', i.supplier_id,
    'lines', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'code', l.code,
          'description', l.description,
          'amount', l.amount,
          'category', l.category
        )
        order by l.created_at
      )
      from public.invoice_lines l
      where l.invoice_id = i.id
    ), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'account', e.account,
          'amount', e.amount,
          'memo', coalesce(e.memo, '')
        )
        order by e.sort_order
      )
      from public.invoice_expense_lines e
      where e.invoice_id = i.id
    ), '[]'::jsonb)
  )
from public.invoices i
left join public.suppliers s on s.id = i.supplier_id
where i.status in ('reviewed', 'exported')
  and i.ocr_text is not null
  and length(btrim(i.ocr_text)) > 0
on conflict (invoice_id) do nothing;
