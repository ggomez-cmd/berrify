-- Puerto Rico payroll setup: employer settings, employee tax profiles, dated
-- rates, opening YTD, and Clover name maps. Feeds the pure payroll engine.
-- Additive. Admin-only RLS. Apply with `npm run db:apply`, not db:push.
-- Does not drop employees, restaurants, or payroll_exports.

-- Same-org child rows: unique (org_id, id) on parents + composite FKs.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'employees_org_id_id_key' and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
      add constraint employees_org_id_id_key unique (org_id, id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'restaurants_org_id_id_key' and conrelid = 'public.restaurants'::regclass
  ) then
    alter table public.restaurants
      add constraint restaurants_org_id_id_key unique (org_id, id);
  end if;
end
$$;

create table if not exists public.payroll_employer_settings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  effective_from date not null,
  sut_rate_bp integer not null check (sut_rate_bp >= 0 and sut_rate_bp <= 10000),
  swh_method text not null default 'annualized'
    check (swh_method in ('annualized', 'biweekly_table')),
  pay_frequency text not null default 'biweekly'
    check (pay_frequency in ('biweekly')),
  daily_ot_mode text not null default 'rolling_24h'
    check (daily_ot_mode in ('rolling_24h', 'calendar_day')),
  workweek_start_day integer not null default 0
    check (workweek_start_day >= 0 and workweek_start_day <= 6),
  time_zone text not null default 'America/Puerto_Rico',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_employer_settings_org_effective_uidx unique (org_id, effective_from)
);

create table if not exists public.payroll_employee_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  employee_id uuid not null,
  employee_number text,
  pay_type text not null check (pay_type in ('payroll', 'cash')),
  is_tipped boolean not null default false,
  hire_date date,
  daily_ot_multiplier_ppm integer not null default 1500000
    check (daily_ot_multiplier_ppm >= 1000000 and daily_ot_multiplier_ppm <= 3000000),
  weekly_ot_multiplier_ppm integer not null default 1500000
    check (weekly_ot_multiplier_ppm >= 1000000 and weekly_ot_multiplier_ppm <= 3000000),
  default_restaurant_id uuid,
  salary_cents bigint
    check (salary_cents is null or salary_cents >= 0),
  personal_exemption text not null default 'none'
    check (personal_exemption in (
      'none',
      'single',
      'married_claiming_half',
      'married_claiming_all',
      'optional_computation'
    )),
  veteran boolean not null default false,
  dependents integer not null default 0 check (dependents >= 0),
  reduced_dependents integer not null default 0 check (reduced_dependents >= 0),
  deduction_cents bigint not null default 0 check (deduction_cents >= 0),
  annual_exemption_override_cents bigint check (annual_exemption_override_cents is null or annual_exemption_override_cents >= 0),
  biweekly_exemption_override_cents bigint check (biweekly_exemption_override_cents is null or biweekly_exemption_override_cents >= 0),
  young_worker_exempt boolean not null default false,
  additional_withholding_cents bigint not null default 0 check (additional_withholding_cents >= 0),
  r41_effective_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_employee_profiles_employee_uidx unique (employee_id),
  constraint payroll_employee_profiles_org_id_id_key unique (org_id, id),
  constraint payroll_employee_profiles_employee_org_fkey
    foreign key (org_id, employee_id) references public.employees (org_id, id) on delete cascade,
  constraint payroll_employee_profiles_restaurant_org_fkey
    foreign key (org_id, default_restaurant_id) references public.restaurants (org_id, id) on delete restrict
);

create unique index if not exists payroll_employee_profiles_org_employee_number_uidx
  on public.payroll_employee_profiles (org_id, employee_number)
  where employee_number is not null;

create table if not exists public.payroll_pay_rates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  employee_id uuid not null,
  restaurant_id uuid,
  position text
    check (position is null or position in ('Server', 'Cook', 'Bartender', 'Host', 'Dish', 'Manager', 'Other')),
  rate_cents bigint not null check (rate_cents >= 0),
  effective_from date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_pay_rates_match_uidx
    unique nulls not distinct (employee_id, restaurant_id, position, effective_from),
  constraint payroll_pay_rates_employee_org_fkey
    foreign key (org_id, employee_id) references public.employees (org_id, id) on delete cascade,
  constraint payroll_pay_rates_restaurant_org_fkey
    foreign key (org_id, restaurant_id) references public.restaurants (org_id, id) on delete restrict
);

create table if not exists public.payroll_opening_balances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  employee_id uuid not null,
  tax_year integer not null check (tax_year >= 2000 and tax_year <= 2100),
  source text not null,
  gross_cents bigint not null check (gross_cents >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_opening_balances_employee_year_source_uidx unique (employee_id, tax_year, source),
  constraint payroll_opening_balances_org_id_id_key unique (org_id, id),
  constraint payroll_opening_balances_employee_org_fkey
    foreign key (org_id, employee_id) references public.employees (org_id, id) on delete cascade
);

create table if not exists public.payroll_opening_balance_taxes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  opening_balance_id uuid not null,
  tax_code text not null
    check (tax_code in ('DIE', 'FED-ADD-MED', 'FED-FUT', 'FED-MED', 'FED-OASDI', 'FSE', 'SUT', 'SWH')),
  taxable_cents bigint not null default 0 check (taxable_cents >= 0),
  withheld_cents bigint not null default 0 check (withheld_cents >= 0),
  employer_cents bigint not null default 0 check (employer_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_opening_balance_taxes_balance_code_uidx unique (opening_balance_id, tax_code),
  constraint payroll_opening_balance_taxes_parent_org_fkey
    foreign key (org_id, opening_balance_id)
    references public.payroll_opening_balances (org_id, id) on delete cascade
);

create table if not exists public.payroll_clover_names (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  clover_name text not null,
  employee_id uuid,
  ignored boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_clover_names_org_name_uidx unique (org_id, clover_name),
  constraint payroll_clover_names_mapped_or_ignored_check
    check (
      (ignored = true and employee_id is null)
      or (ignored = false and employee_id is not null)
    ),
  constraint payroll_clover_names_employee_org_fkey
    foreign key (org_id, employee_id) references public.employees (org_id, id) on delete cascade
);

create index if not exists payroll_employer_settings_org_id_idx
  on public.payroll_employer_settings (org_id);
create index if not exists payroll_employee_profiles_org_id_idx
  on public.payroll_employee_profiles (org_id);
create index if not exists payroll_employee_profiles_employee_id_idx
  on public.payroll_employee_profiles (employee_id);
create index if not exists payroll_pay_rates_org_id_idx
  on public.payroll_pay_rates (org_id);
create index if not exists payroll_pay_rates_employee_id_idx
  on public.payroll_pay_rates (employee_id);
create index if not exists payroll_pay_rates_restaurant_id_idx
  on public.payroll_pay_rates (restaurant_id);
create index if not exists payroll_opening_balances_org_id_idx
  on public.payroll_opening_balances (org_id);
create index if not exists payroll_opening_balances_employee_id_idx
  on public.payroll_opening_balances (employee_id);
create index if not exists payroll_opening_balance_taxes_org_id_idx
  on public.payroll_opening_balance_taxes (org_id);
create index if not exists payroll_opening_balance_taxes_opening_balance_id_idx
  on public.payroll_opening_balance_taxes (opening_balance_id);
create index if not exists payroll_clover_names_org_id_idx
  on public.payroll_clover_names (org_id);
create index if not exists payroll_clover_names_employee_id_idx
  on public.payroll_clover_names (employee_id);

drop trigger if exists payroll_employer_settings_set_updated_at on public.payroll_employer_settings;
create trigger payroll_employer_settings_set_updated_at
  before update on public.payroll_employer_settings
  for each row execute function public.set_updated_at();

drop trigger if exists payroll_employee_profiles_set_updated_at on public.payroll_employee_profiles;
create trigger payroll_employee_profiles_set_updated_at
  before update on public.payroll_employee_profiles
  for each row execute function public.set_updated_at();

drop trigger if exists payroll_pay_rates_set_updated_at on public.payroll_pay_rates;
create trigger payroll_pay_rates_set_updated_at
  before update on public.payroll_pay_rates
  for each row execute function public.set_updated_at();

drop trigger if exists payroll_opening_balances_set_updated_at on public.payroll_opening_balances;
create trigger payroll_opening_balances_set_updated_at
  before update on public.payroll_opening_balances
  for each row execute function public.set_updated_at();

drop trigger if exists payroll_opening_balance_taxes_set_updated_at on public.payroll_opening_balance_taxes;
create trigger payroll_opening_balance_taxes_set_updated_at
  before update on public.payroll_opening_balance_taxes
  for each row execute function public.set_updated_at();

drop trigger if exists payroll_clover_names_set_updated_at on public.payroll_clover_names;
create trigger payroll_clover_names_set_updated_at
  before update on public.payroll_clover_names
  for each row execute function public.set_updated_at();

alter table public.payroll_employer_settings enable row level security;
alter table public.payroll_employee_profiles enable row level security;
alter table public.payroll_pay_rates enable row level security;
alter table public.payroll_opening_balances enable row level security;
alter table public.payroll_opening_balance_taxes enable row level security;
alter table public.payroll_clover_names enable row level security;

drop policy if exists payroll_employer_settings_admin on public.payroll_employer_settings;
create policy payroll_employer_settings_admin on public.payroll_employer_settings
  for all using (public.has_org_role(org_id, array['admin']))
  with check (public.has_org_role(org_id, array['admin']));

drop policy if exists payroll_employee_profiles_admin on public.payroll_employee_profiles;
create policy payroll_employee_profiles_admin on public.payroll_employee_profiles
  for all using (public.has_org_role(org_id, array['admin']))
  with check (public.has_org_role(org_id, array['admin']));

drop policy if exists payroll_pay_rates_admin on public.payroll_pay_rates;
create policy payroll_pay_rates_admin on public.payroll_pay_rates
  for all using (public.has_org_role(org_id, array['admin']))
  with check (public.has_org_role(org_id, array['admin']));

drop policy if exists payroll_opening_balances_admin on public.payroll_opening_balances;
create policy payroll_opening_balances_admin on public.payroll_opening_balances
  for all using (public.has_org_role(org_id, array['admin']))
  with check (public.has_org_role(org_id, array['admin']));

drop policy if exists payroll_opening_balance_taxes_admin on public.payroll_opening_balance_taxes;
create policy payroll_opening_balance_taxes_admin on public.payroll_opening_balance_taxes
  for all using (public.has_org_role(org_id, array['admin']))
  with check (public.has_org_role(org_id, array['admin']));

drop policy if exists payroll_clover_names_admin on public.payroll_clover_names;
create policy payroll_clover_names_admin on public.payroll_clover_names
  for all using (public.has_org_role(org_id, array['admin']))
  with check (public.has_org_role(org_id, array['admin']));

grant select, insert, update, delete on public.payroll_employer_settings to authenticated;
grant select, insert, update, delete on public.payroll_employee_profiles to authenticated;
grant select, insert, update, delete on public.payroll_pay_rates to authenticated;
grant select, insert, update, delete on public.payroll_opening_balances to authenticated;
grant select, insert, update, delete on public.payroll_opening_balance_taxes to authenticated;
grant select, insert, update, delete on public.payroll_clover_names to authenticated;
