-- One payroll run per restaurant, each with its own pay schedule. YTD stays
-- org-wide so same-date restaurant runs share tax caps. Additive. Apply with
-- `npm run db:apply`, not db:push.
-- Does not change org-wide legacy runs (restaurant_id null).

-- ---------------------------------------------------------------------------
-- Employer settings: weekly frequency, clock_in_day, rounding, meal deduct
-- ---------------------------------------------------------------------------

alter table public.payroll_employer_settings
  drop constraint if exists payroll_employer_settings_pay_frequency_check;
alter table public.payroll_employer_settings
  add constraint payroll_employer_settings_pay_frequency_check
  check (pay_frequency in ('weekly', 'biweekly'));

alter table public.payroll_employer_settings
  drop constraint if exists payroll_employer_settings_daily_ot_mode_check;
alter table public.payroll_employer_settings
  add constraint payroll_employer_settings_daily_ot_mode_check
  check (daily_ot_mode in ('rolling_24h', 'calendar_day', 'clock_in_day'));

alter table public.payroll_employer_settings
  add column if not exists punch_rounding text not null default 'none';
alter table public.payroll_employer_settings
  drop constraint if exists payroll_employer_settings_punch_rounding_check;
alter table public.payroll_employer_settings
  add constraint payroll_employer_settings_punch_rounding_check
  check (punch_rounding in ('none', 'hundredth_hour'));

alter table public.payroll_employer_settings
  add column if not exists hourly_pay_rounding text not null default 'per_line';
alter table public.payroll_employer_settings
  drop constraint if exists payroll_employer_settings_hourly_pay_rounding_check;
alter table public.payroll_employer_settings
  add constraint payroll_employer_settings_hourly_pay_rounding_check
  check (hourly_pay_rounding in ('per_line', 'period'));

alter table public.payroll_employer_settings
  add column if not exists meal_deduct_after_minutes integer;
alter table public.payroll_employer_settings
  add column if not exists meal_deduct_minutes integer;
alter table public.payroll_employer_settings
  drop constraint if exists payroll_employer_settings_meal_deduct_check;
alter table public.payroll_employer_settings
  add constraint payroll_employer_settings_meal_deduct_check
  check (
    (meal_deduct_after_minutes is null and meal_deduct_minutes is null)
    or (
      meal_deduct_after_minutes is not null
      and meal_deduct_minutes is not null
      and meal_deduct_after_minutes > 0
      and meal_deduct_minutes > 0
    )
  );

-- ---------------------------------------------------------------------------
-- Employee profiles: fixed SWH and payment method
-- ---------------------------------------------------------------------------

alter table public.payroll_employee_profiles
  add column if not exists fixed_swh_cents bigint;
alter table public.payroll_employee_profiles
  drop constraint if exists payroll_employee_profiles_fixed_swh_cents_check;
alter table public.payroll_employee_profiles
  add constraint payroll_employee_profiles_fixed_swh_cents_check
  check (fixed_swh_cents is null or fixed_swh_cents >= 0);

alter table public.payroll_employee_profiles
  add column if not exists payment_method text;
alter table public.payroll_employee_profiles
  drop constraint if exists payroll_employee_profiles_payment_method_check;
alter table public.payroll_employee_profiles
  add constraint payroll_employee_profiles_payment_method_check
  check (payment_method is null or payment_method in ('ach', 'check', 'cash'));

create or replace function public.save_payroll_employee_setup(
  target_employee_id uuid,
  profile jsonb,
  rates jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  emp public.employees;
  rate_row jsonb;
begin
  select * into emp
  from public.employees
  where id = target_employee_id;

  if not found then
    raise exception 'employee not found';
  end if;

  if not public.has_org_role(emp.org_id, array['admin']) then
    raise exception 'not authorized';
  end if;

  if jsonb_typeof(profile) is distinct from 'object' then
    raise exception 'profile must be a json object';
  end if;

  if jsonb_typeof(rates) is distinct from 'array' then
    raise exception 'rates must be a json array';
  end if;

  insert into public.payroll_employee_profiles (
    org_id,
    employee_id,
    employee_number,
    pay_type,
    is_tipped,
    hire_date,
    daily_ot_multiplier_ppm,
    weekly_ot_multiplier_ppm,
    default_restaurant_id,
    salary_cents,
    personal_exemption,
    veteran,
    dependents,
    reduced_dependents,
    deduction_cents,
    annual_exemption_override_cents,
    biweekly_exemption_override_cents,
    young_worker_exempt,
    additional_withholding_cents,
    fixed_swh_cents,
    payment_method,
    r41_effective_date,
    notes
  ) values (
    emp.org_id,
    target_employee_id,
    nullif(profile->>'employee_number', ''),
    profile->>'pay_type',
    (profile->>'is_tipped')::boolean,
    nullif(profile->>'hire_date', '')::date,
    (profile->>'daily_ot_multiplier_ppm')::integer,
    (profile->>'weekly_ot_multiplier_ppm')::integer,
    nullif(profile->>'default_restaurant_id', '')::uuid,
    (profile->>'salary_cents')::bigint,
    profile->>'personal_exemption',
    (profile->>'veteran')::boolean,
    (profile->>'dependents')::integer,
    (profile->>'reduced_dependents')::integer,
    (profile->>'deduction_cents')::bigint,
    (profile->>'annual_exemption_override_cents')::bigint,
    (profile->>'biweekly_exemption_override_cents')::bigint,
    (profile->>'young_worker_exempt')::boolean,
    (profile->>'additional_withholding_cents')::bigint,
    (profile->>'fixed_swh_cents')::bigint,
    nullif(profile->>'payment_method', ''),
    nullif(profile->>'r41_effective_date', '')::date,
    nullif(profile->>'notes', '')
  )
  on conflict (employee_id) do update set
    employee_number = excluded.employee_number,
    pay_type = excluded.pay_type,
    is_tipped = excluded.is_tipped,
    hire_date = excluded.hire_date,
    daily_ot_multiplier_ppm = excluded.daily_ot_multiplier_ppm,
    weekly_ot_multiplier_ppm = excluded.weekly_ot_multiplier_ppm,
    default_restaurant_id = excluded.default_restaurant_id,
    salary_cents = excluded.salary_cents,
    personal_exemption = excluded.personal_exemption,
    veteran = excluded.veteran,
    dependents = excluded.dependents,
    reduced_dependents = excluded.reduced_dependents,
    deduction_cents = excluded.deduction_cents,
    annual_exemption_override_cents = excluded.annual_exemption_override_cents,
    biweekly_exemption_override_cents = excluded.biweekly_exemption_override_cents,
    young_worker_exempt = excluded.young_worker_exempt,
    additional_withholding_cents = excluded.additional_withholding_cents,
    fixed_swh_cents = excluded.fixed_swh_cents,
    payment_method = excluded.payment_method,
    r41_effective_date = excluded.r41_effective_date,
    notes = excluded.notes;

  delete from public.payroll_pay_rates
  where employee_id = target_employee_id
    and org_id = emp.org_id;

  for rate_row in select value from jsonb_array_elements(rates)
  loop
    insert into public.payroll_pay_rates (
      org_id,
      employee_id,
      restaurant_id,
      position,
      rate_cents,
      effective_from
    ) values (
      emp.org_id,
      target_employee_id,
      nullif(rate_row->>'restaurant_id', '')::uuid,
      nullif(rate_row->>'position', ''),
      (rate_row->>'rate_cents')::bigint,
      (rate_row->>'effective_from')::date
    );
  end loop;
end;
$$;

revoke all on function public.save_payroll_employee_setup(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_payroll_employee_setup(uuid, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Pay schedules: one per restaurant
-- ---------------------------------------------------------------------------

create table if not exists public.payroll_pay_schedules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  restaurant_id uuid not null,
  frequency text not null check (frequency in ('weekly', 'biweekly')),
  anchor_period_start date not null,
  check_lag_days integer not null default 5 check (check_lag_days >= 0 and check_lag_days <= 31),
  taxes_via_provider boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_pay_schedules_org_restaurant_uidx unique (org_id, restaurant_id),
  constraint payroll_pay_schedules_restaurant_org_fkey
    foreign key (org_id, restaurant_id) references public.restaurants (org_id, id) on delete restrict
);

create index if not exists payroll_pay_schedules_org_id_idx
  on public.payroll_pay_schedules (org_id);

drop trigger if exists payroll_pay_schedules_set_updated_at on public.payroll_pay_schedules;
create trigger payroll_pay_schedules_set_updated_at
  before update on public.payroll_pay_schedules
  for each row execute function public.set_updated_at();

alter table public.payroll_pay_schedules enable row level security;

drop policy if exists payroll_pay_schedules_admin on public.payroll_pay_schedules;
create policy payroll_pay_schedules_admin on public.payroll_pay_schedules
  for all using (public.has_org_role(org_id, array['admin']))
  with check (public.has_org_role(org_id, array['admin']));

grant select, insert, update, delete on public.payroll_pay_schedules to authenticated;

-- ---------------------------------------------------------------------------
-- Clover names: optional restaurant scope
-- ---------------------------------------------------------------------------

alter table public.payroll_clover_names
  add column if not exists restaurant_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'payroll_clover_names_restaurant_org_fkey'
      and conrelid = 'public.payroll_clover_names'::regclass
  ) then
    alter table public.payroll_clover_names
      add constraint payroll_clover_names_restaurant_org_fkey
      foreign key (org_id, restaurant_id) references public.restaurants (org_id, id) on delete restrict;
  end if;
end
$$;

alter table public.payroll_clover_names
  drop constraint if exists payroll_clover_names_org_name_uidx;
drop index if exists public.payroll_clover_names_org_name_uidx;
alter table public.payroll_clover_names
  drop constraint if exists payroll_clover_names_org_restaurant_name_uidx;
alter table public.payroll_clover_names
  add constraint payroll_clover_names_org_restaurant_name_uidx
  unique nulls not distinct (org_id, restaurant_id, clover_name);

-- ---------------------------------------------------------------------------
-- Payroll runs: nullable restaurant_id (null = legacy org-wide)
-- ---------------------------------------------------------------------------

alter table public.payroll_runs
  add column if not exists restaurant_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'payroll_runs_restaurant_org_fkey'
      and conrelid = 'public.payroll_runs'::regclass
  ) then
    alter table public.payroll_runs
      add constraint payroll_runs_restaurant_org_fkey
      foreign key (org_id, restaurant_id) references public.restaurants (org_id, id) on delete restrict;
  end if;
end
$$;

create index if not exists payroll_runs_restaurant_id_idx
  on public.payroll_runs (restaurant_id);

drop index if exists public.payroll_runs_org_check_date_live_uidx;
create unique index if not exists payroll_runs_org_restaurant_check_date_live_uidx
  on public.payroll_runs (org_id, restaurant_id, check_date)
  nulls not distinct
  where status is distinct from 'void';

create or replace function public.payroll_runs_guard_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.status is distinct from 'draft' then
      raise exception 'payroll run inserts must be draft';
    end if;
    return NEW;
  end if;

  if TG_OP = 'DELETE' then
    if OLD.status is distinct from 'draft' then
      raise exception 'locked payroll run cannot be deleted';
    end if;
    return OLD;
  end if;

  if NEW.restaurant_id is distinct from OLD.restaurant_id then
    raise exception 'payroll run restaurant_id cannot change';
  end if;

  if OLD.status = 'void' then
    raise exception 'void payroll run is immutable';
  end if;

  if OLD.status = 'approved' then
    if NEW.status is distinct from 'void' then
      raise exception 'approved payroll run is immutable';
    end if;
    if
      NEW.org_id is distinct from OLD.org_id
      or NEW.period_start is distinct from OLD.period_start
      or NEW.period_end is distinct from OLD.period_end
      or NEW.check_date is distinct from OLD.check_date
      or NEW.hours_source is distinct from OLD.hours_source
      or NEW.schedule_id is distinct from OLD.schedule_id
      or NEW.settings is distinct from OLD.settings
      or NEW.inputs is distinct from OLD.inputs
      or NEW.gross_cents is distinct from OLD.gross_cents
      or NEW.employee_withholdings_cents is distinct from OLD.employee_withholdings_cents
      or NEW.net_cents is distinct from OLD.net_cents
      or NEW.employer_taxes_cents is distinct from OLD.employer_taxes_cents
      or NEW.employer_cost_cents is distinct from OLD.employer_cost_cents
      or NEW.cash_gross_cents is distinct from OLD.cash_gross_cents
      or NEW.errors is distinct from OLD.errors
      or NEW.warnings is distinct from OLD.warnings
      or NEW.approved_by is distinct from OLD.approved_by
      or NEW.approved_at is distinct from OLD.approved_at
      or NEW.notes is distinct from OLD.notes
      or NEW.time_clock_from is distinct from OLD.time_clock_from
      or NEW.time_clock_until is distinct from OLD.time_clock_until
    then
      raise exception 'approved payroll run is immutable';
    end if;
    return NEW;
  end if;

  if OLD.status is distinct from 'draft' then
    raise exception 'invalid payroll run status transition';
  end if;

  if NEW.status is distinct from 'draft' and NEW.status is distinct from 'approved' then
    raise exception 'invalid payroll run status transition';
  end if;

  return NEW;
end;
$$;

create or replace function public.payroll_runs_guard_org_restaurant_overlap()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if NEW.status is not distinct from 'void' then
    return NEW;
  end if;

  if exists (
    select 1
    from public.payroll_runs other
    where other.org_id = NEW.org_id
      and other.id is distinct from NEW.id
      and other.check_date = NEW.check_date
      and other.status is distinct from 'void'
      and (
        (NEW.restaurant_id is null and other.restaurant_id is not null)
        or (NEW.restaurant_id is not null and other.restaurant_id is null)
      )
  ) then
    raise exception 'a live org-wide run and a live restaurant run cannot share the same check date';
  end if;

  return NEW;
end;
$$;

revoke all on function public.payroll_runs_guard_org_restaurant_overlap()
  from public, anon, authenticated;

drop trigger if exists payroll_runs_guard_org_restaurant_overlap on public.payroll_runs;
create trigger payroll_runs_guard_org_restaurant_overlap
  before insert or update on public.payroll_runs
  for each row execute function public.payroll_runs_guard_org_restaurant_overlap();

-- ---------------------------------------------------------------------------
-- YTD: approved same-date runs count (draft never includes itself)
-- ---------------------------------------------------------------------------

create or replace function public.payroll_ytd_basis_revision(
  target_org_id uuid,
  tax_year integer,
  before_check_date date
)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select md5(
    coalesce(
      (
        select string_agg(
          r.id::text
            || E'\t' || r.status
            || E'\t' || coalesce(to_char(r.approved_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '')
            || E'\t' || coalesce(to_char(r.voided_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), ''),
          E'\n'
          order by r.check_date, r.id
        )
        from public.payroll_runs r
        where r.org_id = payroll_ytd_basis_revision.target_org_id
          and extract(year from r.check_date)::integer = payroll_ytd_basis_revision.tax_year
          and (
            (
              r.check_date < payroll_ytd_basis_revision.before_check_date
              and r.status is distinct from 'draft'
            )
            or (
              r.check_date = payroll_ytd_basis_revision.before_check_date
              and r.status = 'approved'
            )
          )
      ),
      ''
    )
    || E'\n--balances--\n'
    || coalesce(
      (
        select string_agg(
          b.id::text
            || E'\t' || b.gross_cents::text
            || E'\t' || coalesce(to_char(b.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), ''),
          E'\n'
          order by b.id
        )
        from public.payroll_opening_balances b
        where b.org_id = payroll_ytd_basis_revision.target_org_id
          and b.tax_year = payroll_ytd_basis_revision.tax_year
      ),
      ''
    )
    || E'\n--taxes--\n'
    || coalesce(
      (
        select string_agg(
          t.id::text
            || E'\t' || t.taxable_cents::text
            || E'\t' || t.withheld_cents::text
            || E'\t' || t.employer_cents::text
            || E'\t' || coalesce(to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), ''),
          E'\n'
          order by t.id
        )
        from public.payroll_opening_balance_taxes t
        join public.payroll_opening_balances b
          on b.id = t.opening_balance_id
         and b.org_id = t.org_id
        where b.org_id = payroll_ytd_basis_revision.target_org_id
          and b.tax_year = payroll_ytd_basis_revision.tax_year
      ),
      ''
    )
  );
$$;

revoke all on function public.payroll_ytd_basis_revision(uuid, integer, date) from public, anon;
grant execute on function public.payroll_ytd_basis_revision(uuid, integer, date) to authenticated;

create or replace function public.load_payroll_ytd_basis(
  target_org_id uuid,
  tax_year integer,
  before_check_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  snapshot jsonb;
begin
  if not public.has_org_role(load_payroll_ytd_basis.target_org_id, array['admin']) then
    raise exception 'not authorized';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(load_payroll_ytd_basis.target_org_id::text || ':' || load_payroll_ytd_basis.tax_year::text, 0)
  );

  select jsonb_build_object(
    'revision', public.payroll_ytd_basis_revision(load_payroll_ytd_basis.target_org_id, load_payroll_ytd_basis.tax_year, load_payroll_ytd_basis.before_check_date),
    'opening_balances', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', b.id,
          'employee_id', b.employee_id,
          'tax_year', b.tax_year,
          'gross_cents', b.gross_cents,
          'taxes', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', t.id,
                'tax_code', t.tax_code,
                'taxable_cents', t.taxable_cents,
                'withheld_cents', t.withheld_cents,
                'employer_cents', t.employer_cents
              )
              order by t.tax_code, t.id
            )
            from public.payroll_opening_balance_taxes t
            where t.opening_balance_id = b.id
              and t.org_id = b.org_id
          ), '[]'::jsonb)
        )
        order by b.employee_id, b.id
      )
      from public.payroll_opening_balances b
      where b.org_id = load_payroll_ytd_basis.target_org_id
        and b.tax_year = load_payroll_ytd_basis.tax_year
    ), '[]'::jsonb),
    'prior_check_taxes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'employee_id', c.employee_id,
          'tax_year', load_payroll_ytd_basis.tax_year,
          'check_date', r.check_date,
          'status', r.status,
          'side', t.side,
          'tax_code', t.tax_code,
          'taxable_cents', t.taxable_cents,
          'amount_cents', t.amount_cents
        )
        order by r.check_date, c.employee_id, t.side, t.tax_code, t.id
      )
      from public.payroll_runs r
      join public.payroll_checks c
        on c.run_id = r.id
       and c.org_id = r.org_id
      join public.payroll_check_taxes t
        on t.check_id = c.id
       and t.org_id = c.org_id
      where r.org_id = load_payroll_ytd_basis.target_org_id
        and extract(year from r.check_date)::integer = load_payroll_ytd_basis.tax_year
        and r.check_date <= load_payroll_ytd_basis.before_check_date
        and r.status = 'approved'
    ), '[]'::jsonb),
    'prior_gross', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'employee_id', c.employee_id,
          'tax_year', load_payroll_ytd_basis.tax_year,
          'check_date', r.check_date,
          'status', r.status,
          'gross_cents', c.gross_cents
        )
        order by r.check_date, c.employee_id, c.id
      )
      from public.payroll_runs r
      join public.payroll_checks c
        on c.run_id = r.id
       and c.org_id = r.org_id
      where r.org_id = load_payroll_ytd_basis.target_org_id
        and extract(year from r.check_date)::integer = load_payroll_ytd_basis.tax_year
        and r.check_date <= load_payroll_ytd_basis.before_check_date
        and r.status = 'approved'
    ), '[]'::jsonb)
  )
  into snapshot;

  return snapshot;
end;
$$;

revoke all on function public.load_payroll_ytd_basis(uuid, integer, date) from public, anon;
grant execute on function public.load_payroll_ytd_basis(uuid, integer, date) to authenticated;

create or replace function public.save_payroll_run_draft(
  target_run_id uuid,
  run jsonb,
  checks jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  run_row public.payroll_runs;
  check_row jsonb;
  earning_row jsonb;
  tax_row jsonb;
  emp_org uuid;
  rest_org uuid;
  resolved_org uuid;
  resolved_id uuid;
  inserted_check_id uuid;
  first_employee uuid;
  run_errors text[];
  run_warnings text[];
  run_tax_year integer;
  expected_revision text;
  current_revision text;
  run_restaurant_id uuid;
begin
  if jsonb_typeof(run) is distinct from 'object' then
    raise exception 'run must be a json object';
  end if;
  if jsonb_typeof(checks) is distinct from 'array' then
    raise exception 'checks must be a json array';
  end if;

  if jsonb_typeof(run->'errors') is distinct from 'array' then
    raise exception 'errors must be a json array';
  end if;
  if jsonb_typeof(run->'warnings') is distinct from 'array' then
    raise exception 'warnings must be a json array';
  end if;
  select coalesce(array_agg(value), '{}'::text[])
    into run_errors
  from jsonb_array_elements_text(run->'errors');
  select coalesce(array_agg(value), '{}'::text[])
    into run_warnings
  from jsonb_array_elements_text(run->'warnings');

  run_restaurant_id := nullif(run->>'restaurant_id', '')::uuid;

  if target_run_id is not null then
    select * into run_row
    from public.payroll_runs
    where id = target_run_id
    for update;

    if not found then
      raise exception 'payroll run not found';
    end if;

    if not public.has_org_role(run_row.org_id, array['admin']) then
      raise exception 'not authorized';
    end if;

    if run_row.status is distinct from 'draft' then
      raise exception 'payroll run is not a draft';
    end if;

    resolved_org := run_row.org_id;
    resolved_id := run_row.id;
    run_restaurant_id := run_row.restaurant_id;
  else
    first_employee := nullif(checks -> 0 ->> 'employee_id', '')::uuid;
    if first_employee is null then
      raise exception 'organization cannot be derived without a check employee';
    end if;

    select org_id into emp_org
    from public.employees
    where id = first_employee;

    if not found then
      raise exception 'employee not found';
    end if;

    if not public.has_org_role(emp_org, array['admin']) then
      raise exception 'not authorized';
    end if;

    resolved_org := emp_org;
    resolved_id := null;
  end if;

  if run_restaurant_id is not null then
    select org_id into rest_org
    from public.restaurants
    where id = run_restaurant_id;

    if not found then
      raise exception 'restaurant not found';
    end if;

    if rest_org is distinct from resolved_org then
      raise exception 'restaurant does not belong to organization';
    end if;
  end if;

  run_tax_year := extract(year from (run->>'check_date')::date)::integer;
  perform pg_advisory_xact_lock(
    hashtextextended(resolved_org::text || ':' || run_tax_year::text, 0)
  );

  expected_revision := nullif(btrim(coalesce(run->>'ytd_basis_revision', '')), '');
  if expected_revision is null then
    raise exception 'payroll run is stale: recalculate';
  end if;

  current_revision := public.payroll_ytd_basis_revision(
    resolved_org,
    run_tax_year,
    (run->>'check_date')::date
  );
  if current_revision is distinct from expected_revision then
    raise exception 'payroll run is stale: recalculate';
  end if;

  for check_row in select value from jsonb_array_elements(checks)
  loop
    select org_id into emp_org
    from public.employees
    where id = (check_row->>'employee_id')::uuid;

    if not found then
      raise exception 'employee not found';
    end if;

    if emp_org is distinct from resolved_org then
      raise exception 'employee does not belong to organization';
    end if;
  end loop;

  if resolved_id is null then
    insert into public.payroll_runs (
      org_id,
      restaurant_id,
      period_start,
      period_end,
      check_date,
      status,
      hours_source,
      schedule_id,
      settings,
      inputs,
      gross_cents,
      employee_withholdings_cents,
      net_cents,
      employer_taxes_cents,
      employer_cost_cents,
      cash_gross_cents,
      errors,
      warnings,
      notes,
      saved_at,
      ytd_basis_revision
    ) values (
      resolved_org,
      run_restaurant_id,
      (run->>'period_start')::date,
      (run->>'period_end')::date,
      (run->>'check_date')::date,
      'draft',
      run->>'hours_source',
      coalesce(run->>'schedule_id', ''),
      coalesce(run->'settings', '{}'::jsonb),
      coalesce(run->'inputs', '{}'::jsonb),
      coalesce((run->>'gross_cents')::bigint, 0),
      coalesce((run->>'employee_withholdings_cents')::bigint, 0),
      coalesce((run->>'net_cents')::bigint, 0),
      coalesce((run->>'employer_taxes_cents')::bigint, 0),
      coalesce((run->>'employer_cost_cents')::bigint, 0),
      coalesce((run->>'cash_gross_cents')::bigint, 0),
      run_errors,
      run_warnings,
      nullif(run->>'notes', ''),
      now(),
      current_revision
    )
    returning id into resolved_id;
  else
    update public.payroll_runs
    set
      period_start = (run->>'period_start')::date,
      period_end = (run->>'period_end')::date,
      check_date = (run->>'check_date')::date,
      hours_source = run->>'hours_source',
      schedule_id = coalesce(run->>'schedule_id', ''),
      settings = coalesce(run->'settings', '{}'::jsonb),
      inputs = coalesce(run->'inputs', '{}'::jsonb),
      gross_cents = coalesce((run->>'gross_cents')::bigint, 0),
      employee_withholdings_cents = coalesce((run->>'employee_withholdings_cents')::bigint, 0),
      net_cents = coalesce((run->>'net_cents')::bigint, 0),
      employer_taxes_cents = coalesce((run->>'employer_taxes_cents')::bigint, 0),
      employer_cost_cents = coalesce((run->>'employer_cost_cents')::bigint, 0),
      cash_gross_cents = coalesce((run->>'cash_gross_cents')::bigint, 0),
      errors = run_errors,
      warnings = run_warnings,
      notes = nullif(run->>'notes', ''),
      saved_at = now(),
      ytd_basis_revision = current_revision
    where id = resolved_id
      and org_id = resolved_org
      and status = 'draft';

    delete from public.payroll_check_taxes
    where org_id = resolved_org
      and check_id in (select id from public.payroll_checks where run_id = resolved_id);

    delete from public.payroll_check_earnings
    where org_id = resolved_org
      and check_id in (select id from public.payroll_checks where run_id = resolved_id);

    delete from public.payroll_checks
    where org_id = resolved_org
      and run_id = resolved_id;
  end if;

  for check_row in select value from jsonb_array_elements(checks)
  loop
    insert into public.payroll_checks (
      org_id,
      run_id,
      employee_id,
      pay_type,
      gross_cents,
      deductions_cents,
      net_cents,
      employer_tax_cents,
      closing_ytd
    ) values (
      resolved_org,
      resolved_id,
      (check_row->>'employee_id')::uuid,
      check_row->>'pay_type',
      coalesce((check_row->>'gross_cents')::bigint, 0),
      coalesce((check_row->>'deductions_cents')::bigint, 0),
      coalesce((check_row->>'net_cents')::bigint, 0),
      coalesce((check_row->>'employer_tax_cents')::bigint, 0),
      coalesce(check_row->'closing_ytd', '{}'::jsonb)
    )
    returning id into inserted_check_id;

    if jsonb_typeof(check_row->'earnings') is distinct from 'array' then
      raise exception 'earnings must be a json array';
    end if;
    if jsonb_typeof(check_row->'taxes') is distinct from 'array' then
      raise exception 'taxes must be a json array';
    end if;

    for earning_row in select value from jsonb_array_elements(check_row->'earnings')
    loop
      if nullif(earning_row->>'restaurant_id', '') is not null then
        select org_id into rest_org
        from public.restaurants
        where id = (earning_row->>'restaurant_id')::uuid;

        if not found then
          raise exception 'restaurant not found';
        end if;

        if rest_org is distinct from resolved_org then
          raise exception 'restaurant does not belong to organization';
        end if;
      end if;

      insert into public.payroll_check_earnings (
        org_id,
        check_id,
        kind,
        restaurant_id,
        position,
        workweek_id,
        hours_hundredths,
        rate_cents,
        amount_cents,
        reason
      ) values (
        resolved_org,
        inserted_check_id,
        earning_row->>'kind',
        nullif(earning_row->>'restaurant_id', '')::uuid,
        nullif(earning_row->>'position', ''),
        nullif(earning_row->>'workweek_id', ''),
        coalesce((earning_row->>'hours_hundredths')::integer, 0),
        (earning_row->>'rate_cents')::bigint,
        coalesce((earning_row->>'amount_cents')::bigint, 0),
        nullif(earning_row->>'reason', '')
      );
    end loop;

    for tax_row in select value from jsonb_array_elements(check_row->'taxes')
    loop
      insert into public.payroll_check_taxes (
        org_id,
        check_id,
        side,
        tax_code,
        taxable_cents,
        amount_cents
      ) values (
        resolved_org,
        inserted_check_id,
        tax_row->>'side',
        tax_row->>'tax_code',
        coalesce((tax_row->>'taxable_cents')::bigint, 0),
        coalesce((tax_row->>'amount_cents')::bigint, 0)
      );
    end loop;
  end loop;

  return resolved_id;
end;
$$;

revoke all on function public.save_payroll_run_draft(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_payroll_run_draft(uuid, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Time-clock guards: restaurant-scoped when the run has a restaurant_id
-- ---------------------------------------------------------------------------

drop function if exists public.payroll_shift_revision_unchecked(uuid, date, date, date);

create or replace function public.payroll_shift_revision_unchecked(
  target_org_id uuid,
  period_start date,
  period_end date,
  check_date date,
  p_restaurant_id uuid default null
)
returns text
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  zone text;
  window_start timestamptz;
  window_end timestamptz;
begin
  zone := public.payroll_hours_time_zone(
    payroll_shift_revision_unchecked.target_org_id,
    payroll_shift_revision_unchecked.check_date
  );
  select w.window_from, w.window_until
    into window_start, window_end
  from public.payroll_time_clock_window(
    payroll_shift_revision_unchecked.target_org_id,
    payroll_shift_revision_unchecked.period_start,
    payroll_shift_revision_unchecked.period_end,
    payroll_shift_revision_unchecked.check_date
  ) w;

  return md5(
    zone
    || E'\t' || coalesce(to_char(window_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '')
    || E'\t' || coalesce(to_char(window_end at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '')
    || E'\n'
    || coalesce(
      (
        select string_agg(
          e.id::text
            || E'\t' || e.employee_id::text
            || E'\t' || coalesce(e.restaurant_id::text, '')
            || E'\t' || e.position
            || E'\t' || coalesce(to_char(e.started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '')
            || E'\t' || coalesce(to_char(e.ended_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '')
            || E'\t' || e.worked_seconds::text
            || E'\t' || e.paid_break_seconds::text
            || E'\t' || e.unpaid_break_seconds::text
            || E'\t' || coalesce(to_char(e.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '')
            || E'\t' || coalesce(
              (
                select string_agg(
                  coalesce(to_char(b.started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '')
                    || E'\t' || coalesce(to_char(b.ended_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '')
                    || E'\t' || b.break_type
                    || E'\t' || b.paid::text,
                  E'\n'
                  order by b.started_at, b.id
                )
                from public.time_breaks b
                where b.time_entry_id = e.id
              ),
              ''
            ),
          E'\n'
          order by e.id
        )
        from public.time_entries e
        where e.org_id = payroll_shift_revision_unchecked.target_org_id
          and e.started_at >= window_start
          and e.started_at < window_end
          and (
            payroll_shift_revision_unchecked.p_restaurant_id is null
            or e.restaurant_id is not distinct from payroll_shift_revision_unchecked.p_restaurant_id
          )
      ),
      ''
    )
  );
end;
$$;

revoke all on function public.payroll_shift_revision_unchecked(uuid, date, date, date, uuid)
  from public, anon, authenticated;

drop function if exists public.payroll_shift_revision(uuid, date, date, date);

create or replace function public.payroll_shift_revision(
  target_org_id uuid,
  period_start date,
  period_end date,
  check_date date,
  p_restaurant_id uuid default null
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  window_start timestamptz;
  window_end timestamptz;
begin
  if not public.has_org_role(payroll_shift_revision.target_org_id, array['admin']) then
    raise exception 'not authorized';
  end if;

  select w.window_from, w.window_until
    into window_start, window_end
  from public.payroll_time_clock_window(
    payroll_shift_revision.target_org_id,
    payroll_shift_revision.period_start,
    payroll_shift_revision.period_end,
    payroll_shift_revision.check_date
  ) w;

  return jsonb_build_object(
    'revision', public.payroll_shift_revision_unchecked(
      payroll_shift_revision.target_org_id,
      payroll_shift_revision.period_start,
      payroll_shift_revision.period_end,
      payroll_shift_revision.check_date,
      payroll_shift_revision.p_restaurant_id
    ),
    'from', window_start,
    'until', window_end
  );
end;
$$;

revoke all on function public.payroll_shift_revision(uuid, date, date, date, uuid) from public, anon;
grant execute on function public.payroll_shift_revision(uuid, date, date, date, uuid) to authenticated;

create or replace function public.payroll_runs_guard_shift_revision()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  expected text;
  provided text;
  computed_from timestamptz;
  computed_until timestamptz;
  approving boolean;
begin
  approving :=
    TG_OP = 'UPDATE'
    and OLD.status = 'draft'
    and NEW.status = 'approved';

  if NEW.hours_source is distinct from 'time_clock' then
    if NEW.status = 'draft' then
      NEW.time_clock_from := null;
      NEW.time_clock_until := null;
    end if;
    return NEW;
  end if;

  if not (NEW.status = 'draft' or approving) then
    return NEW;
  end if;

  perform 1
  from public.employees e
  where e.org_id = NEW.org_id
  order by e.id
  for key share;
  perform 1
  from public.restaurants r
  where r.org_id = NEW.org_id
  order by r.id
  for key share;

  perform public.time_clock_payroll_lock(NEW.org_id);

  select w.window_from, w.window_until
    into computed_from, computed_until
  from public.payroll_time_clock_window(
    NEW.org_id,
    NEW.period_start,
    NEW.period_end,
    NEW.check_date
  ) w;

  expected := public.payroll_shift_revision_unchecked(
    NEW.org_id,
    NEW.period_start,
    NEW.period_end,
    NEW.check_date,
    NEW.restaurant_id
  );
  provided := NEW.inputs->>'shiftRevision';

  if provided is null or provided is distinct from expected then
    raise exception 'shifts changed since this run was calculated: stale, recalculate';
  end if;

  if NEW.status = 'draft' then
    NEW.time_clock_from := computed_from;
    NEW.time_clock_until := computed_until;
    return NEW;
  end if;

  if
    NEW.time_clock_from is distinct from computed_from
    or NEW.time_clock_until is distinct from computed_until
  then
    raise exception 'shifts changed since this run was calculated: stale, recalculate';
  end if;

  NEW.time_clock_from := OLD.time_clock_from;
  NEW.time_clock_until := OLD.time_clock_until;

  if now() < NEW.time_clock_until then
    raise exception 'the pay period has not ended yet';
  end if;

  if exists (
    select 1
    from public.clock_sessions s
    where s.org_id = NEW.org_id
      and s.clocked_in_at < NEW.time_clock_until
      and (
        NEW.restaurant_id is null
        or s.restaurant_id is not distinct from NEW.restaurant_id
        or s.restaurant_id is null
      )
  ) then
    raise exception 'employees are still clocked in from this period: clock them out first';
  end if;

  return NEW;
end;
$$;

revoke all on function public.payroll_runs_guard_shift_revision()
  from public, anon, authenticated;

drop function if exists public.time_entry_reject_if_approved_run(uuid, timestamptz);

create or replace function public.time_entry_reject_if_approved_run(
  target_org_id uuid,
  started_at timestamptz,
  p_restaurant_id uuid default null
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  locked_check date;
begin
  select r.check_date
    into locked_check
  from public.payroll_runs r
  where r.org_id = time_entry_reject_if_approved_run.target_org_id
    and r.status = 'approved'
    and r.hours_source = 'time_clock'
    and r.time_clock_from is not null
    and r.time_clock_until is not null
    and time_entry_reject_if_approved_run.started_at >= r.time_clock_from
    and time_entry_reject_if_approved_run.started_at < r.time_clock_until
    and (
      r.restaurant_id is null
      or time_entry_reject_if_approved_run.p_restaurant_id is null
      or r.restaurant_id is not distinct from time_entry_reject_if_approved_run.p_restaurant_id
    )
  order by r.check_date, r.id
  limit 1;

  if locked_check is not null then
    raise exception 'shift is in an approved payroll run (check date %): void that run first', locked_check;
  end if;
end;
$$;

revoke all on function public.time_entry_reject_if_approved_run(uuid, timestamptz, uuid)
  from public, anon, authenticated;

create or replace function public.time_entries_guard_payroll_window()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  org uuid;
  old_start timestamptz;
  new_start timestamptz;
  old_restaurant uuid;
  new_restaurant uuid;
begin
  if TG_OP = 'DELETE' then
    org := OLD.org_id;
    old_start := OLD.started_at;
    old_restaurant := OLD.restaurant_id;
  elsif TG_OP = 'UPDATE' then
    org := coalesce(NEW.org_id, OLD.org_id);
    old_start := OLD.started_at;
    new_start := NEW.started_at;
    old_restaurant := OLD.restaurant_id;
    new_restaurant := NEW.restaurant_id;
  else
    org := NEW.org_id;
    new_start := NEW.started_at;
    new_restaurant := NEW.restaurant_id;
  end if;

  if old_start is not null then
    perform public.time_entry_lock_started_at(org, old_start);
    perform public.time_entry_reject_if_approved_run(org, old_start, old_restaurant);
  end if;
  if
    new_start is not null
    and (
      new_start is distinct from old_start
      or new_restaurant is distinct from old_restaurant
    )
  then
    perform public.time_entry_lock_started_at(org, new_start);
    perform public.time_entry_reject_if_approved_run(org, new_start, new_restaurant);
  end if;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

revoke all on function public.time_entries_guard_payroll_window()
  from public, anon, authenticated;

create or replace function public.time_breaks_guard_payroll_window()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  entry public.time_entries%rowtype;
  entry_id uuid;
begin
  if TG_OP = 'DELETE' then
    entry_id := OLD.time_entry_id;
  else
    entry_id := NEW.time_entry_id;
  end if;

  select * into entry
  from public.time_entries
  where id = entry_id;

  if not found then
    if TG_OP = 'DELETE' then
      return OLD;
    end if;
    return NEW;
  end if;

  perform public.time_entry_lock_started_at(entry.org_id, entry.started_at);
  perform public.time_entry_reject_if_approved_run(entry.org_id, entry.started_at, entry.restaurant_id);

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

revoke all on function public.time_breaks_guard_payroll_window()
  from public, anon, authenticated;

create or replace function public.clock_events_guard_approved_payroll()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  locked_check date;
begin
  perform public.time_entry_lock_started_at(NEW.org_id, NEW.occurred_at);

  select r.check_date
    into locked_check
  from public.payroll_runs r
  where r.org_id = NEW.org_id
    and r.status = 'approved'
    and r.hours_source = 'time_clock'
    and r.time_clock_from is not null
    and r.time_clock_until is not null
    and NEW.occurred_at >= r.time_clock_from
    and NEW.occurred_at < r.time_clock_until
    and (
      r.restaurant_id is null
      or NEW.restaurant_id is null
      or r.restaurant_id is not distinct from NEW.restaurant_id
    )
  order by r.check_date, r.id
  limit 1;

  if locked_check is not null then
    raise exception 'punch is in an approved payroll run (check date %): void that run first', locked_check;
  end if;

  return NEW;
end;
$$;

revoke all on function public.clock_events_guard_approved_payroll()
  from public, anon, authenticated;

create or replace function public.manager_save_time_entry(
  target_entry_id uuid,
  target_employee_id uuid,
  target_restaurant_id uuid,
  target_position text,
  new_started_at timestamptz,
  new_ended_at timestamptz,
  new_breaks jsonb,
  reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  entry_row public.time_entries%rowtype;
  emp public.employees%rowtype;
  rest_org uuid;
  cleaned_reason text;
  cleaned_position text;
  action text;
  before_snap jsonb;
  after_snap jsonb;
  resolved_id uuid;
  zone text;
  old_local date;
  new_local date;
  gross integer;
  paid_secs integer := 0;
  unpaid_secs integer := 0;
  worked integer;
  n integer;
  i integer;
  j integer;
  brk jsonb;
  b_start timestamptz;
  b_end timestamptz;
  b_type text;
  b_paid boolean;
  b_dur integer;
  starts timestamptz[] := '{}';
  ends timestamptz[] := '{}';
  types text[] := '{}';
  paids boolean[] := '{}';
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  cleaned_reason := btrim(coalesce(manager_save_time_entry.reason, ''));
  if cleaned_reason = '' or char_length(cleaned_reason) > 500 then
    raise exception 'reason is required';
  end if;

  if manager_save_time_entry.target_entry_id is not null then
    select * into entry_row
    from public.time_entries
    where id = manager_save_time_entry.target_entry_id;

    if not found then
      raise exception 'time entry not found';
    end if;

    if
      manager_save_time_entry.target_employee_id is not null
      and manager_save_time_entry.target_employee_id is distinct from entry_row.employee_id
    then
      raise exception 'employee cannot be changed';
    end if;

    perform 1
    from public.restaurants r
    where r.id in (manager_save_time_entry.target_restaurant_id, entry_row.restaurant_id)
    order by r.id
    for key share;

    select * into emp
    from public.employees
    where id = entry_row.employee_id
    for update;

    select * into entry_row
    from public.time_entries
    where id = manager_save_time_entry.target_entry_id
    for update;

    if not found then
      raise exception 'time entry not found';
    end if;

    action := 'update';
    before_snap := public.time_entry_snapshot(entry_row.id);
  else
    if manager_save_time_entry.target_employee_id is null then
      raise exception 'employee is required';
    end if;

    perform 1
    from public.restaurants r
    where r.id in (manager_save_time_entry.target_restaurant_id)
    order by r.id
    for key share;

    select * into emp
    from public.employees
    where id = manager_save_time_entry.target_employee_id
    for update;

    if not found then
      raise exception 'employee not found';
    end if;

    action := 'create';
    before_snap := null;
  end if;

  if not found then
    raise exception 'employee not found';
  end if;

  if not public.has_org_role(emp.org_id, array['admin', 'manager']) then
    raise exception 'not authorized';
  end if;

  if manager_save_time_entry.target_restaurant_id is null then
    raise exception 'restaurant is required';
  end if;

  select org_id into rest_org
  from public.restaurants
  where id = manager_save_time_entry.target_restaurant_id;

  if not found then
    raise exception 'restaurant not found';
  end if;
  if rest_org is distinct from emp.org_id then
    raise exception 'restaurant does not belong to organization';
  end if;

  cleaned_position := btrim(coalesce(manager_save_time_entry.target_position, ''));
  if cleaned_position = '' then
    raise exception 'position is required';
  end if;

  if manager_save_time_entry.new_started_at is null or manager_save_time_entry.new_ended_at is null then
    raise exception 'started_at and ended_at are required';
  end if;
  if manager_save_time_entry.new_ended_at <= manager_save_time_entry.new_started_at then
    raise exception 'ended_at must be after started_at';
  end if;
  if extract(epoch from (
    manager_save_time_entry.new_ended_at - manager_save_time_entry.new_started_at
  )) > 24 * 3600 then
    raise exception 'shift cannot exceed 24 hours';
  end if;
  if manager_save_time_entry.new_ended_at > (now() + interval '5 minutes') then
    raise exception 'ended_at cannot be more than 5 minutes in the future';
  end if;

  if jsonb_typeof(manager_save_time_entry.new_breaks) is distinct from 'array' then
    raise exception 'breaks must be a json array';
  end if;

  n := jsonb_array_length(manager_save_time_entry.new_breaks);
  for i in 0 .. n - 1 loop
    brk := manager_save_time_entry.new_breaks -> i;
    b_start := (brk->>'started_at')::timestamptz;
    b_end := (brk->>'ended_at')::timestamptz;
    b_type := brk->>'break_type';
    if jsonb_typeof(brk->'paid') is distinct from 'boolean' then
      raise exception 'break paid must be a boolean';
    end if;
    b_paid := (brk->>'paid')::boolean;

    if b_start is null or b_end is null then
      raise exception 'break started_at and ended_at are required';
    end if;
    if b_end <= b_start then
      raise exception 'break ended_at must be after started_at';
    end if;
    if b_type is distinct from 'meal' and b_type is distinct from 'rest' and b_type is distinct from 'other' then
      raise exception 'break_type is invalid';
    end if;
    if
      b_start < manager_save_time_entry.new_started_at
      or b_end > manager_save_time_entry.new_ended_at
    then
      raise exception 'break is outside the shift';
    end if;

    starts := starts || b_start;
    ends := ends || b_end;
    types := types || b_type;
    paids := paids || b_paid;
  end loop;

  n := coalesce(array_length(starts, 1), 0);
  for i in 1 .. n loop
    for j in i + 1 .. n loop
      if starts[i] < ends[j] and starts[j] < ends[i] then
        raise exception 'breaks overlap';
      end if;
    end loop;
  end loop;

  if exists (
    select 1
    from public.time_entries other
    where other.employee_id = emp.id
      and other.id is distinct from manager_save_time_entry.target_entry_id
      and other.started_at < manager_save_time_entry.new_ended_at
      and other.ended_at > manager_save_time_entry.new_started_at
  ) then
    raise exception 'shift overlaps another time entry or open clock session';
  end if;

  if exists (
    select 1
    from public.clock_sessions s
    where s.employee_id = emp.id
      and s.clocked_in_at < manager_save_time_entry.new_ended_at
  ) then
    raise exception 'shift overlaps another time entry or open clock session';
  end if;

  zone := public.payroll_hours_time_zone(emp.org_id, (manager_save_time_entry.new_started_at at time zone 'UTC')::date);
  new_local := (manager_save_time_entry.new_started_at at time zone zone)::date;
  if action = 'update' then
    old_local := (entry_row.started_at at time zone zone)::date;
  end if;

  perform public.time_entry_lock_payroll_years(
    emp.org_id,
    array[old_local, new_local]
  );

  if action = 'update' then
    perform public.time_entry_reject_if_approved_run(emp.org_id, entry_row.started_at, entry_row.restaurant_id);
  end if;
  perform public.time_entry_reject_if_approved_run(
    emp.org_id,
    manager_save_time_entry.new_started_at,
    manager_save_time_entry.target_restaurant_id
  );

  gross := floor(extract(epoch from (
    manager_save_time_entry.new_ended_at - manager_save_time_entry.new_started_at
  )))::integer;
  for i in 1 .. n loop
    b_dur := floor(extract(epoch from (ends[i] - starts[i])))::integer;
    if paids[i] then
      paid_secs := paid_secs + b_dur;
    else
      unpaid_secs := unpaid_secs + b_dur;
    end if;
  end loop;
  worked := gross - unpaid_secs;
  if worked < 0 then
    raise exception 'unpaid breaks exceed shift length';
  end if;

  if action = 'create' then
    insert into public.time_entries (
      org_id,
      employee_id,
      staff_shift_id,
      restaurant_id,
      position,
      started_at,
      ended_at,
      gross_seconds,
      paid_break_seconds,
      unpaid_break_seconds,
      worked_seconds,
      status
    ) values (
      emp.org_id,
      emp.id,
      null,
      manager_save_time_entry.target_restaurant_id,
      cleaned_position,
      manager_save_time_entry.new_started_at,
      manager_save_time_entry.new_ended_at,
      gross,
      paid_secs,
      unpaid_secs,
      worked,
      'pending'
    )
    returning id into resolved_id;
  else
    update public.time_entries
    set
      restaurant_id = manager_save_time_entry.target_restaurant_id,
      position = cleaned_position,
      started_at = manager_save_time_entry.new_started_at,
      ended_at = manager_save_time_entry.new_ended_at,
      gross_seconds = gross,
      paid_break_seconds = paid_secs,
      unpaid_break_seconds = unpaid_secs,
      worked_seconds = worked
    where id = entry_row.id;

    resolved_id := entry_row.id;
    delete from public.time_breaks where time_entry_id = resolved_id;
  end if;

  for i in 1 .. n loop
    insert into public.time_breaks (
      org_id,
      time_entry_id,
      started_at,
      ended_at,
      duration_seconds,
      break_type,
      paid
    ) values (
      emp.org_id,
      resolved_id,
      starts[i],
      ends[i],
      floor(extract(epoch from (ends[i] - starts[i])))::integer,
      types[i],
      paids[i]
    );
  end loop;

  after_snap := public.time_entry_snapshot(resolved_id);

  insert into public.time_entry_edits (
    org_id,
    time_entry_id,
    employee_id,
    action,
    before,
    after,
    reason,
    edited_by
  ) values (
    emp.org_id,
    resolved_id,
    emp.id,
    action,
    before_snap,
    after_snap,
    cleaned_reason,
    auth.uid()
  );

  return resolved_id;
end;
$$;

create or replace function public.manager_void_time_entry(
  target_entry_id uuid,
  reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  entry_row public.time_entries%rowtype;
  cleaned_reason text;
  zone text;
  local_start date;
  before_snap jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  cleaned_reason := btrim(coalesce(manager_void_time_entry.reason, ''));
  if cleaned_reason = '' or char_length(cleaned_reason) > 500 then
    raise exception 'reason is required';
  end if;

  select * into entry_row
  from public.time_entries
  where id = manager_void_time_entry.target_entry_id
  for update;

  if not found then
    raise exception 'time entry not found';
  end if;

  if not public.has_org_role(entry_row.org_id, array['admin', 'manager']) then
    raise exception 'not authorized';
  end if;

  zone := public.payroll_hours_time_zone(
    entry_row.org_id,
    (entry_row.started_at at time zone 'UTC')::date
  );
  local_start := (entry_row.started_at at time zone zone)::date;

  perform public.time_entry_lock_payroll_years(entry_row.org_id, array[local_start]);
  perform public.time_entry_reject_if_approved_run(entry_row.org_id, entry_row.started_at, entry_row.restaurant_id);

  before_snap := public.time_entry_snapshot(entry_row.id);

  insert into public.time_entry_edits (
    org_id,
    time_entry_id,
    employee_id,
    action,
    before,
    after,
    reason,
    edited_by
  ) values (
    entry_row.org_id,
    entry_row.id,
    entry_row.employee_id,
    'void',
    before_snap,
    null,
    cleaned_reason,
    auth.uid()
  );

  delete from public.time_entries where id = entry_row.id;
end;
$$;

revoke all on function public.manager_save_time_entry(uuid, uuid, uuid, text, timestamptz, timestamptz, jsonb, text) from public, anon;
revoke all on function public.manager_void_time_entry(uuid, text) from public, anon;
grant execute on function public.manager_save_time_entry(uuid, uuid, uuid, text, timestamptz, timestamptz, jsonb, text) to authenticated;
grant execute on function public.manager_void_time_entry(uuid, text) to authenticated;

drop function if exists public.list_approved_time_clock_windows(uuid);

create or replace function public.list_approved_time_clock_windows(target_org_id uuid)
returns table (
  period_start date,
  period_end date,
  check_date date,
  restaurant_id uuid,
  time_zone text,
  "from" timestamptz,
  "until" timestamptz
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  if not public.has_org_role(
    list_approved_time_clock_windows.target_org_id,
    array['admin', 'manager']
  ) then
    raise exception 'not authorized';
  end if;

  return query
  select
    r.period_start,
    r.period_end,
    r.check_date,
    r.restaurant_id,
    coalesce(r.settings->>'timeZone', public.payroll_hours_time_zone(r.org_id, r.check_date)),
    r.time_clock_from,
    r.time_clock_until
  from public.payroll_runs r
  where r.org_id = list_approved_time_clock_windows.target_org_id
    and r.status = 'approved'
    and r.hours_source = 'time_clock'
    and r.time_clock_from is not null
    and r.time_clock_until is not null
  order by r.check_date, r.id;
end;
$$;

revoke all on function public.list_approved_time_clock_windows(uuid) from public, anon;
grant execute on function public.list_approved_time_clock_windows(uuid) to authenticated;
