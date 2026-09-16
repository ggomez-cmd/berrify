-- Payroll export snapshots (hours × roster rate for one restaurant workweek).
-- Additive. Manager-only, same as invoices. Apply with `npm run db:apply`, not db:push.

create table if not exists public.payroll_exports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete restrict,
  period_start timestamptz not null,
  period_end timestamptz not null,
  exported_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint payroll_exports_period_check check (period_end > period_start)
);

create table if not exists public.payroll_export_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  payroll_export_id uuid not null references public.payroll_exports (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete restrict,
  regular_seconds integer not null default 0 check (regular_seconds >= 0),
  ot_seconds integer not null default 0 check (ot_seconds >= 0),
  hourly_rate numeric not null default 0,
  gross numeric not null default 0,
  created_at timestamptz not null default now(),
  constraint payroll_export_lines_export_employee_uidx unique (payroll_export_id, employee_id)
);

create index if not exists payroll_exports_org_id_idx on public.payroll_exports (org_id);
create index if not exists payroll_exports_org_restaurant_period_idx
  on public.payroll_exports (org_id, restaurant_id, period_start);
create index if not exists payroll_export_lines_export_id_idx
  on public.payroll_export_lines (payroll_export_id);

alter table public.payroll_exports enable row level security;
alter table public.payroll_export_lines enable row level security;

drop policy if exists payroll_exports_manager on public.payroll_exports;
create policy payroll_exports_manager on public.payroll_exports
  for all using (public.has_org_role(org_id, array['owner', 'manager']))
  with check (public.has_org_role(org_id, array['owner', 'manager']));

drop policy if exists payroll_export_lines_manager on public.payroll_export_lines;
create policy payroll_export_lines_manager on public.payroll_export_lines
  for all using (public.has_org_role(org_id, array['owner', 'manager']))
  with check (public.has_org_role(org_id, array['owner', 'manager']));

grant select, insert, update, delete on public.payroll_exports to authenticated;
grant select, insert, update, delete on public.payroll_export_lines to authenticated;
