-- Puerto Rico payroll runs: draft → review → approve/lock, per-check lines,
-- and void. Additive. Admin-only RLS. Apply with `npm run db:apply`, not db:push.
-- Does not reuse or alter legacy payroll_periods / payroll_employee_records /
-- payroll_adjustments.

-- jsonb keys for save_payroll_run_draft match PayrollRunDraftPayload and
-- PayrollCheckDraftPayload in src/lib/payroll/runs.ts, including errors/warnings.

create table if not exists public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  check_date date not null,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'void')),
  hours_source text not null
    check (hours_source in ('time_clock', 'clover')),
  schedule_id text not null,
  settings jsonb not null default '{}'::jsonb,
  inputs jsonb not null default '{}'::jsonb,
  gross_cents bigint not null default 0,
  employee_withholdings_cents bigint not null default 0,
  net_cents bigint not null default 0,
  employer_taxes_cents bigint not null default 0,
  employer_cost_cents bigint not null default 0,
  cash_gross_cents bigint not null default 0,
  errors text[] not null default '{}'::text[],
  warnings text[] not null default '{}'::text[],
  approved_by uuid,
  approved_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  notes text,
  -- Last draft save (audit). Staleness uses ytd_basis_revision, not this timestamp.
  saved_at timestamptz not null default now(),
  -- Server-owned md5 of prior non-draft runs and opening balances at calculate/save.
  ytd_basis_revision text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_runs_period_check check (period_end >= period_start),
  constraint payroll_runs_org_id_id_key unique (org_id, id)
);

create unique index if not exists payroll_runs_org_check_date_live_uidx
  on public.payroll_runs (org_id, check_date)
  where status is distinct from 'void';

create table if not exists public.payroll_checks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  run_id uuid not null,
  employee_id uuid not null,
  pay_type text not null check (pay_type in ('payroll', 'cash')),
  gross_cents bigint not null default 0,
  deductions_cents bigint not null default 0,
  net_cents bigint not null default 0,
  employer_tax_cents bigint not null default 0,
  closing_ytd jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_checks_run_employee_uidx unique (run_id, employee_id),
  constraint payroll_checks_org_id_id_key unique (org_id, id),
  constraint payroll_checks_run_org_fkey
    foreign key (org_id, run_id) references public.payroll_runs (org_id, id) on delete cascade,
  constraint payroll_checks_employee_org_fkey
    foreign key (org_id, employee_id) references public.employees (org_id, id) on delete restrict
);

create table if not exists public.payroll_check_earnings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  check_id uuid not null,
  kind text not null
    check (kind in ('regular', 'overtime', 'tips', 'salary', 'min_wage_makeup', 'adjustment')),
  restaurant_id uuid,
  position text,
  workweek_id text,
  hours_hundredths integer not null default 0,
  rate_cents bigint,
  amount_cents bigint not null default 0,
  reason text,
  created_at timestamptz not null default now(),
  constraint payroll_check_earnings_check_org_fkey
    foreign key (org_id, check_id) references public.payroll_checks (org_id, id) on delete cascade,
  constraint payroll_check_earnings_restaurant_org_fkey
    foreign key (org_id, restaurant_id) references public.restaurants (org_id, id) on delete restrict
);

create table if not exists public.payroll_check_taxes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  check_id uuid not null,
  side text not null check (side in ('employee', 'employer')),
  tax_code text not null
    check (tax_code in ('DIE', 'FED-ADD-MED', 'FED-FUT', 'FED-MED', 'FED-OASDI', 'FSE', 'SUT', 'SWH')),
  taxable_cents bigint not null default 0,
  amount_cents bigint not null default 0,
  created_at timestamptz not null default now(),
  constraint payroll_check_taxes_check_side_code_uidx unique (check_id, side, tax_code),
  constraint payroll_check_taxes_check_org_fkey
    foreign key (org_id, check_id) references public.payroll_checks (org_id, id) on delete cascade
);

create index if not exists payroll_runs_org_id_idx on public.payroll_runs (org_id);
create index if not exists payroll_runs_org_check_date_idx on public.payroll_runs (org_id, check_date);
create index if not exists payroll_checks_org_id_idx on public.payroll_checks (org_id);
create index if not exists payroll_checks_run_id_idx on public.payroll_checks (run_id);
create index if not exists payroll_checks_employee_id_idx on public.payroll_checks (employee_id);
create index if not exists payroll_check_earnings_org_id_idx on public.payroll_check_earnings (org_id);
create index if not exists payroll_check_earnings_check_id_idx on public.payroll_check_earnings (check_id);
create index if not exists payroll_check_taxes_org_id_idx on public.payroll_check_taxes (org_id);
create index if not exists payroll_check_taxes_check_id_idx on public.payroll_check_taxes (check_id);

drop trigger if exists payroll_runs_set_updated_at on public.payroll_runs;
create trigger payroll_runs_set_updated_at
  before update on public.payroll_runs
  for each row execute function public.set_updated_at();

drop trigger if exists payroll_checks_set_updated_at on public.payroll_checks;
create trigger payroll_checks_set_updated_at
  before update on public.payroll_checks
  for each row execute function public.set_updated_at();

create or replace function public.payroll_run_status(target_run_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  select status from public.payroll_runs where id = target_run_id;
$$;

create or replace function public.payroll_run_status_for_check(target_check_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  select r.status
  from public.payroll_checks c
  join public.payroll_runs r on r.id = c.run_id
  where c.id = target_check_id;
$$;

revoke all on function public.payroll_run_status(uuid) from public, anon;
revoke all on function public.payroll_run_status_for_check(uuid) from public, anon;
grant execute on function public.payroll_run_status(uuid) to authenticated;
grant execute on function public.payroll_run_status_for_check(uuid) to authenticated;

create or replace function public.payroll_run_require_draft(target_run_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  run_status text;
begin
  if target_run_id is null then
    raise exception 'locked payroll run lines are immutable';
  end if;

  select status into run_status
  from public.payroll_runs
  where id = target_run_id
  for share;

  if not found or run_status is distinct from 'draft' then
    raise exception 'locked payroll run lines are immutable';
  end if;
end;
$$;

create or replace function public.payroll_run_require_draft_for_check(target_check_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  run_status text;
begin
  if target_check_id is null then
    raise exception 'locked payroll run lines are immutable';
  end if;

  select r.status into run_status
  from public.payroll_checks c
  join public.payroll_runs r on r.id = c.run_id
  where c.id = target_check_id
  for share of r;

  if not found or run_status is distinct from 'draft' then
    raise exception 'locked payroll run lines are immutable';
  end if;
end;
$$;

revoke all on function public.payroll_run_require_draft(uuid) from public, anon, authenticated;
revoke all on function public.payroll_run_require_draft_for_check(uuid) from public, anon, authenticated;

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

create or replace function public.payroll_run_children_guard_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if TG_TABLE_NAME = 'payroll_checks' then
    if TG_OP = 'UPDATE' and NEW.run_id is distinct from OLD.run_id then
      raise exception 'payroll check run_id cannot change';
    end if;
    if TG_OP = 'DELETE' then
      perform public.payroll_run_require_draft(OLD.run_id);
      return OLD;
    end if;
    if TG_OP = 'INSERT' then
      perform public.payroll_run_require_draft(NEW.run_id);
      return NEW;
    end if;
    perform public.payroll_run_require_draft(OLD.run_id);
    perform public.payroll_run_require_draft(NEW.run_id);
    return NEW;
  end if;

  if TG_OP = 'UPDATE' and NEW.check_id is distinct from OLD.check_id then
    raise exception 'payroll line check_id cannot change';
  end if;
  if TG_OP = 'DELETE' then
    perform public.payroll_run_require_draft_for_check(OLD.check_id);
    return OLD;
  end if;
  if TG_OP = 'INSERT' then
    perform public.payroll_run_require_draft_for_check(NEW.check_id);
    return NEW;
  end if;
  perform public.payroll_run_require_draft_for_check(OLD.check_id);
  perform public.payroll_run_require_draft_for_check(NEW.check_id);
  return NEW;
end;
$$;

drop trigger if exists payroll_runs_guard_immutable on public.payroll_runs;
create trigger payroll_runs_guard_immutable
  before insert or update or delete on public.payroll_runs
  for each row execute function public.payroll_runs_guard_immutable();

drop trigger if exists payroll_checks_guard_immutable on public.payroll_checks;
create trigger payroll_checks_guard_immutable
  before insert or update or delete on public.payroll_checks
  for each row execute function public.payroll_run_children_guard_immutable();

drop trigger if exists payroll_check_earnings_guard_immutable on public.payroll_check_earnings;
create trigger payroll_check_earnings_guard_immutable
  before insert or update or delete on public.payroll_check_earnings
  for each row execute function public.payroll_run_children_guard_immutable();

drop trigger if exists payroll_check_taxes_guard_immutable on public.payroll_check_taxes;
create trigger payroll_check_taxes_guard_immutable
  before insert or update or delete on public.payroll_check_taxes
  for each row execute function public.payroll_run_children_guard_immutable();

alter table public.payroll_runs enable row level security;
alter table public.payroll_checks enable row level security;
alter table public.payroll_check_earnings enable row level security;
alter table public.payroll_check_taxes enable row level security;

drop policy if exists payroll_runs_admin on public.payroll_runs;
create policy payroll_runs_admin on public.payroll_runs
  for select using (public.has_org_role(org_id, array['admin']));

drop policy if exists payroll_checks_admin on public.payroll_checks;
create policy payroll_checks_admin on public.payroll_checks
  for select using (public.has_org_role(org_id, array['admin']));

drop policy if exists payroll_check_earnings_admin on public.payroll_check_earnings;
create policy payroll_check_earnings_admin on public.payroll_check_earnings
  for select using (public.has_org_role(org_id, array['admin']));

drop policy if exists payroll_check_taxes_admin on public.payroll_check_taxes;
create policy payroll_check_taxes_admin on public.payroll_check_taxes
  for select using (public.has_org_role(org_id, array['admin']));

revoke all on table public.payroll_runs from public, anon, authenticated;
revoke all on table public.payroll_checks from public, anon, authenticated;
revoke all on table public.payroll_check_earnings from public, anon, authenticated;
revoke all on table public.payroll_check_taxes from public, anon, authenticated;
grant select on table public.payroll_runs to authenticated;
grant select on table public.payroll_checks to authenticated;
grant select on table public.payroll_check_earnings to authenticated;
grant select on table public.payroll_check_taxes to authenticated;

-- Stable YTD basis fingerprint: prior non-draft runs before the check date, plus
-- every opening-balance and tax row for the org tax year. Format is fixed so the
-- same rows always hash the same way across sessions.
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
        where r.org_id = target_org_id
          and extract(year from r.check_date)::integer = tax_year
          and r.check_date < before_check_date
          and r.status is distinct from 'draft'
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
        where b.org_id = target_org_id
          and b.tax_year = tax_year
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
        where b.org_id = target_org_id
          and b.tax_year = tax_year
      ),
      ''
    )
  );
$$;

revoke all on function public.payroll_ytd_basis_revision(uuid, integer, date) from public, anon;
grant execute on function public.payroll_ytd_basis_revision(uuid, integer, date) to authenticated;

-- One snapshot of the YTD history the editor needs. Callers must use this RPC
-- instead of separate table queries so calculate/save share the same revision.
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
  if not public.has_org_role(target_org_id, array['admin']) then
    raise exception 'not authorized';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(target_org_id::text || ':' || tax_year::text, 0)
  );

  select jsonb_build_object(
    'revision', public.payroll_ytd_basis_revision(target_org_id, tax_year, before_check_date),
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
      where b.org_id = target_org_id
        and b.tax_year = tax_year
    ), '[]'::jsonb),
    'prior_check_taxes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'employee_id', c.employee_id,
          'tax_year', tax_year,
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
      where r.org_id = target_org_id
        and extract(year from r.check_date)::integer = tax_year
        and r.check_date < before_check_date
        and r.status = 'approved'
    ), '[]'::jsonb),
    'prior_gross', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'employee_id', c.employee_id,
          'tax_year', tax_year,
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
      where r.org_id = target_org_id
        and extract(year from r.check_date)::integer = tax_year
        and r.check_date < before_check_date
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

create or replace function public.approve_payroll_run(target_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  run_row public.payroll_runs;
  check_rec public.payroll_checks;
  check_count integer;
  earnings_sum bigint;
  employee_tax_sum bigint;
  employer_tax_sum bigint;
  payroll_gross bigint := 0;
  cash_gross bigint := 0;
  withholdings_sum bigint := 0;
  net_sum bigint := 0;
  employer_tax_total bigint := 0;
  run_tax_year integer;
  current_revision text;
begin
  select * into run_row
  from public.payroll_runs
  where id = target_run_id
  for update;

  if not found then
    raise exception 'payroll run not found';
  end if;

  run_tax_year := extract(year from run_row.check_date)::integer;
  perform pg_advisory_xact_lock(
    hashtextextended(run_row.org_id::text || ':' || run_tax_year::text, 0)
  );

  if not public.has_org_role(run_row.org_id, array['admin']) then
    raise exception 'not authorized';
  end if;

  if run_row.status is distinct from 'draft' then
    raise exception 'payroll run is not a draft';
  end if;

  if exists (
    select 1
    from public.payroll_runs other
    where other.org_id = run_row.org_id
      and other.id is distinct from run_row.id
      and extract(year from other.check_date) = run_tax_year
      and other.check_date > run_row.check_date
      and other.status = 'approved'
  ) then
    raise exception 'a later run is already approved';
  end if;

  if exists (
    select 1
    from public.payroll_runs other
    where other.org_id = run_row.org_id
      and other.id is distinct from run_row.id
      and extract(year from other.check_date) = run_tax_year
      and other.check_date < run_row.check_date
      and other.status = 'draft'
  ) then
    raise exception 'approve or discard earlier draft runs first';
  end if;

  current_revision := public.payroll_ytd_basis_revision(
    run_row.org_id,
    run_tax_year,
    run_row.check_date
  );
  if current_revision is distinct from run_row.ytd_basis_revision then
    raise exception 'payroll run is stale: recalculate';
  end if;

  if coalesce(cardinality(run_row.errors), 0) > 0 then
    raise exception 'payroll run has errors';
  end if;

  select count(*) into check_count
  from public.payroll_checks
  where run_id = target_run_id
    and org_id = run_row.org_id;

  if check_count = 0 then
    raise exception 'payroll run has no checks';
  end if;

  for check_rec in
    select *
    from public.payroll_checks
    where run_id = target_run_id
      and org_id = run_row.org_id
  loop
    if check_rec.net_cents < 0 then
      raise exception 'payroll check has a negative net';
    end if;

    select coalesce(sum(amount_cents), 0) into earnings_sum
    from public.payroll_check_earnings
    where check_id = check_rec.id
      and org_id = run_row.org_id;

    if check_rec.gross_cents is distinct from earnings_sum then
      raise exception 'payroll check gross does not match earnings';
    end if;

    select coalesce(sum(amount_cents), 0) into employee_tax_sum
    from public.payroll_check_taxes
    where check_id = check_rec.id
      and org_id = run_row.org_id
      and side = 'employee';

    if check_rec.deductions_cents is distinct from employee_tax_sum then
      raise exception 'payroll check deductions do not match employee taxes';
    end if;

    if check_rec.net_cents is distinct from (check_rec.gross_cents - check_rec.deductions_cents) then
      raise exception 'payroll check net does not match gross minus deductions';
    end if;

    select coalesce(sum(amount_cents), 0) into employer_tax_sum
    from public.payroll_check_taxes
    where check_id = check_rec.id
      and org_id = run_row.org_id
      and side = 'employer';

    if check_rec.employer_tax_cents is distinct from employer_tax_sum then
      raise exception 'payroll check employer tax does not match employer taxes';
    end if;

    if check_rec.pay_type = 'payroll' then
      payroll_gross := payroll_gross + check_rec.gross_cents;
      withholdings_sum := withholdings_sum + check_rec.deductions_cents;
      net_sum := net_sum + check_rec.net_cents;
      employer_tax_total := employer_tax_total + check_rec.employer_tax_cents;
    elsif check_rec.pay_type = 'cash' then
      cash_gross := cash_gross + check_rec.gross_cents;
    end if;
  end loop;

  if
    run_row.gross_cents is distinct from payroll_gross
    or run_row.employee_withholdings_cents is distinct from withholdings_sum
    or run_row.net_cents is distinct from net_sum
    or run_row.employer_taxes_cents is distinct from employer_tax_total
    or run_row.employer_cost_cents is distinct from (payroll_gross + employer_tax_total)
    or run_row.cash_gross_cents is distinct from cash_gross
  then
    raise exception 'payroll run totals do not match checks';
  end if;

  update public.payroll_runs
  set
    status = 'approved',
    approved_by = auth.uid(),
    approved_at = now()
  where id = target_run_id
    and org_id = run_row.org_id
    and status = 'draft';
end;
$$;

revoke all on function public.approve_payroll_run(uuid) from public, anon;
grant execute on function public.approve_payroll_run(uuid) to authenticated;

create or replace function public.void_payroll_run(target_run_id uuid, reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  run_row public.payroll_runs;
begin
  select * into run_row
  from public.payroll_runs
  where id = target_run_id
  for update;

  if not found then
    raise exception 'payroll run not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(run_row.org_id::text || ':' || extract(year from run_row.check_date)::text, 0)
  );

  if not public.has_org_role(run_row.org_id, array['admin']) then
    raise exception 'not authorized';
  end if;

  if run_row.status is distinct from 'approved' then
    raise exception 'only an approved payroll run can be voided';
  end if;

  if reason is null or btrim(reason) = '' then
    raise exception 'void reason is required';
  end if;

  update public.payroll_runs
  set
    status = 'void',
    voided_at = now(),
    void_reason = btrim(reason)
  where id = target_run_id
    and org_id = run_row.org_id
    and status = 'approved';
end;
$$;

revoke all on function public.void_payroll_run(uuid, text) from public, anon;
grant execute on function public.void_payroll_run(uuid, text) to authenticated;

create or replace function public.discard_payroll_run_draft(target_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  run_row public.payroll_runs;
begin
  select * into run_row
  from public.payroll_runs
  where id = target_run_id
  for update;

  if not found then
    raise exception 'payroll run not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(run_row.org_id::text || ':' || extract(year from run_row.check_date)::text, 0)
  );

  if not public.has_org_role(run_row.org_id, array['admin']) then
    raise exception 'not authorized';
  end if;

  if run_row.status is distinct from 'draft' then
    raise exception 'only a draft payroll run can be discarded';
  end if;

  -- Delete children while the draft parent is still present so immutability
  -- guards can confirm draft status. Cascade-after-parent-delete treats a
  -- missing run as locked.
  delete from public.payroll_check_taxes
  where org_id = run_row.org_id
    and check_id in (select id from public.payroll_checks where run_id = target_run_id);

  delete from public.payroll_check_earnings
  where org_id = run_row.org_id
    and check_id in (select id from public.payroll_checks where run_id = target_run_id);

  delete from public.payroll_checks
  where org_id = run_row.org_id
    and run_id = target_run_id;

  delete from public.payroll_runs
  where id = target_run_id
    and org_id = run_row.org_id
    and status = 'draft';
end;
$$;

revoke all on function public.discard_payroll_run_draft(uuid) from public, anon;
grant execute on function public.discard_payroll_run_draft(uuid) to authenticated;

-- 0029 is already applied. Recreate the importer here so it takes the org/year
-- advisory lock before writing. Security definer so it can still replace tax
-- rows after authenticated DELETE is revoked on the opening-balance tables.
-- Direct table DELETE is not serialized; delete_payroll_opening_balance is.
-- A missed lock still fails save/approve because the revision includes deletes.
create or replace function public.import_payroll_opening_balances(
  target_org_id uuid,
  balances jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  balance_row jsonb;
  tax_row jsonb;
  emp_org uuid;
  balance_id uuid;
  lock_year integer;
begin
  if not public.has_org_role(target_org_id, array['admin']) then
    raise exception 'not authorized';
  end if;

  if jsonb_typeof(balances) is distinct from 'array' then
    raise exception 'balances must be a json array';
  end if;

  for lock_year in
    select distinct (value->>'tax_year')::integer
    from jsonb_array_elements(balances)
    order by 1
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(target_org_id::text || ':' || lock_year::text, 0)
    );
  end loop;

  for balance_row in select value from jsonb_array_elements(balances)
  loop
    select org_id into emp_org
    from public.employees
    where id = (balance_row->>'employee_id')::uuid;

    if not found then
      raise exception 'employee not found';
    end if;

    if emp_org is distinct from target_org_id then
      raise exception 'employee does not belong to organization';
    end if;

    if jsonb_typeof(balance_row->'taxes') is distinct from 'array' then
      raise exception 'taxes must be a json array';
    end if;

    insert into public.payroll_opening_balances (
      org_id,
      employee_id,
      tax_year,
      source,
      gross_cents
    ) values (
      target_org_id,
      (balance_row->>'employee_id')::uuid,
      (balance_row->>'tax_year')::integer,
      balance_row->>'source',
      (balance_row->>'gross_cents')::bigint
    )
    on conflict (employee_id, tax_year, source) do update
      set gross_cents = excluded.gross_cents
    returning id into balance_id;

    delete from public.payroll_opening_balance_taxes
    where opening_balance_id = balance_id
      and org_id = target_org_id;

    for tax_row in select value from jsonb_array_elements(balance_row->'taxes')
    loop
      insert into public.payroll_opening_balance_taxes (
        org_id,
        opening_balance_id,
        tax_code,
        taxable_cents,
        withheld_cents,
        employer_cents
      ) values (
        target_org_id,
        balance_id,
        tax_row->>'tax_code',
        (tax_row->>'taxable_cents')::bigint,
        (tax_row->>'withheld_cents')::bigint,
        (tax_row->>'employer_cents')::bigint
      );
    end loop;
  end loop;
end;
$$;

revoke all on function public.import_payroll_opening_balances(uuid, jsonb) from public, anon;
grant execute on function public.import_payroll_opening_balances(uuid, jsonb) to authenticated;

create or replace function public.delete_payroll_opening_balance(target_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  balance_row public.payroll_opening_balances;
begin
  select * into balance_row
  from public.payroll_opening_balances
  where id = target_id
  for update;

  if not found then
    raise exception 'opening balance not found';
  end if;

  if not public.has_org_role(balance_row.org_id, array['admin']) then
    raise exception 'not authorized';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(balance_row.org_id::text || ':' || balance_row.tax_year::text, 0)
  );

  delete from public.payroll_opening_balance_taxes
  where opening_balance_id = target_id
    and org_id = balance_row.org_id;

  delete from public.payroll_opening_balances
  where id = target_id
    and org_id = balance_row.org_id;
end;
$$;

revoke all on function public.delete_payroll_opening_balance(uuid) from public, anon;
grant execute on function public.delete_payroll_opening_balance(uuid) to authenticated;

revoke delete on table public.payroll_opening_balances from authenticated;
revoke delete on table public.payroll_opening_balance_taxes from authenticated;
