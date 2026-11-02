-- Manager/admin correction of closed time-clock shifts before payroll,
-- with a required reason and an audit trail. Additive. Apply with
-- `npm run db:apply`, not db:push.
-- Does not alter clock_events. Edits stay because reconcile_attendance()
-- does not rebuild time_entries.
-- payroll_runs.inputs.shiftRevision is the md5 from payroll_shift_revision_unchecked
-- (also returned as payroll_shift_revision.revision). The hash includes the
-- hours time zone and the computed window bounds so a settings change between
-- fetch and save is stale. A BEFORE trigger rejects time_clock draft saves and
-- approvals when the revision is missing or stale, writes time_clock_from/until
-- on draft save, and on approve requires those stored bounds to still match.
-- Approved-run protection uses the stored bounds, never a recomputed window.
-- Parameter references are qualified with the function name.

alter table public.payroll_runs
  add column if not exists time_clock_from timestamptz;
alter table public.payroll_runs
  add column if not exists time_clock_until timestamptz;

create table if not exists public.time_entry_edits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  time_entry_id uuid not null,
  employee_id uuid not null,
  action text not null check (action in ('create', 'update', 'void')),
  before jsonb,
  after jsonb,
  reason text not null,
  edited_by uuid,
  edited_at timestamptz not null default now(),
  constraint time_entry_edits_before_check check (
    (action = 'create' and before is null)
    or (action is distinct from 'create')
  ),
  constraint time_entry_edits_after_check check (
    (action = 'void' and after is null)
    or (action is distinct from 'void')
  )
);

create index if not exists time_entry_edits_org_entry_idx
  on public.time_entry_edits (org_id, time_entry_id);

alter table public.time_entry_edits enable row level security;

drop policy if exists time_entry_edits_select_manager on public.time_entry_edits;
create policy time_entry_edits_select_manager on public.time_entry_edits
  for select using (public.has_org_role(org_id, array['admin', 'manager']));

revoke all on table public.time_entry_edits from public, anon, authenticated;
grant select on table public.time_entry_edits to authenticated;

create or replace function public.payroll_hours_time_zone(
  target_org_id uuid,
  as_of date
)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select s.time_zone
      from public.payroll_employer_settings s
      where s.org_id = payroll_hours_time_zone.target_org_id
        and s.effective_from <= payroll_hours_time_zone.as_of
      order by s.effective_from desc
      limit 1
    ),
    (
      select o.timezone
      from public.organizations o
      where o.id = payroll_hours_time_zone.target_org_id
    ),
    'America/Puerto_Rico'
  );
$$;

revoke all on function public.payroll_hours_time_zone(uuid, date)
  from public, anon, authenticated;

drop function if exists public.payroll_time_clock_window(uuid, date, date);

create or replace function public.payroll_time_clock_window(
  target_org_id uuid,
  period_start date,
  period_end date,
  check_date date
)
returns table (
  window_from timestamptz,
  window_until timestamptz
)
language sql
stable
set search_path = public, pg_temp
as $$
  select
    (
      (payroll_time_clock_window.period_start - 8) + time '00:00'
    ) at time zone public.payroll_hours_time_zone(
      payroll_time_clock_window.target_org_id,
      payroll_time_clock_window.check_date
    ),
    (
      (payroll_time_clock_window.period_end + 1) + time '00:00'
    ) at time zone public.payroll_hours_time_zone(
      payroll_time_clock_window.target_org_id,
      payroll_time_clock_window.check_date
    );
$$;

revoke all on function public.payroll_time_clock_window(uuid, date, date, date)
  from public, anon, authenticated;

drop function if exists public.payroll_shift_revision_unchecked(uuid, date, date);

create or replace function public.payroll_shift_revision_unchecked(
  target_org_id uuid,
  period_start date,
  period_end date,
  check_date date
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
      ),
      ''
    )
  );
end;
$$;

revoke all on function public.payroll_shift_revision_unchecked(uuid, date, date, date)
  from public, anon, authenticated;

drop function if exists public.payroll_shift_revision(uuid, date, date);
drop function if exists public.payroll_shift_revision(uuid, date, date, date);

create or replace function public.payroll_shift_revision(
  target_org_id uuid,
  period_start date,
  period_end date,
  check_date date
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
      payroll_shift_revision.check_date
    ),
    'from', window_start,
    'until', window_end
  );
end;
$$;

drop function if exists public.list_approved_time_clock_windows(uuid);

create or replace function public.list_approved_time_clock_windows(target_org_id uuid)
returns table (
  period_start date,
  period_end date,
  check_date date,
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

create or replace function public.time_entry_snapshot(target_entry_id uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when e.id is null then null
    else jsonb_build_object(
      'id', e.id,
      'employee_id', e.employee_id,
      'restaurant_id', e.restaurant_id,
      'position', e.position,
      'started_at', e.started_at,
      'ended_at', e.ended_at,
      'gross_seconds', e.gross_seconds,
      'paid_break_seconds', e.paid_break_seconds,
      'unpaid_break_seconds', e.unpaid_break_seconds,
      'worked_seconds', e.worked_seconds,
      'status', e.status,
      'staff_shift_id', e.staff_shift_id,
      'breaks', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'started_at', b.started_at,
              'ended_at', b.ended_at,
              'break_type', b.break_type,
              'paid', b.paid,
              'duration_seconds', b.duration_seconds
            )
            order by b.started_at, b.id
          )
          from public.time_breaks b
          where b.time_entry_id = e.id
        ),
        '[]'::jsonb
      )
    )
  end
  from public.time_entries e
  where e.id = time_entry_snapshot.target_entry_id;
$$;

revoke all on function public.time_entry_snapshot(uuid)
  from public, anon, authenticated;

-- One lock per organization serializes every shift/punch writer with time_clock
-- draft saves and approvals. Writers take only this lock; save and approve take
-- it after their tax-year lock (0030), so no wait cycle is possible, and coverage
-- doesn't depend on how far a check date is from the shifts or on time zones.
create or replace function public.time_clock_payroll_lock(target_org_id uuid)
returns void
language sql
set search_path = public, pg_temp
as $$
  select pg_advisory_xact_lock(
    hashtextextended(time_clock_payroll_lock.target_org_id::text || ':time_clock_payroll', 0)
  );
$$;

revoke all on function public.time_clock_payroll_lock(uuid)
  from public, anon, authenticated;

-- Kept for its callers; the dates no longer matter.
create or replace function public.time_entry_lock_payroll_years(
  target_org_id uuid,
  local_dates date[]
)
returns void
language sql
set search_path = public, pg_temp
as $$
  select public.time_clock_payroll_lock(time_entry_lock_payroll_years.target_org_id);
$$;

revoke all on function public.time_entry_lock_payroll_years(uuid, date[])
  from public, anon, authenticated;

create or replace function public.time_entry_reject_if_approved_run(
  target_org_id uuid,
  started_at timestamptz
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
  order by r.check_date, r.id
  limit 1;

  if locked_check is not null then
    raise exception 'shift is in an approved payroll run (check date %): void that run first', locked_check;
  end if;
end;
$$;

revoke all on function public.time_entry_reject_if_approved_run(uuid, timestamptz)
  from public, anon, authenticated;

create or replace function public.time_entry_lock_started_at(
  target_org_id uuid,
  started_at timestamptz
)
returns void
language sql
set search_path = public, pg_temp
as $$
  select public.time_clock_payroll_lock(time_entry_lock_started_at.target_org_id);
$$;

revoke all on function public.time_entry_lock_started_at(uuid, timestamptz)
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
begin
  if TG_OP = 'DELETE' then
    org := OLD.org_id;
    old_start := OLD.started_at;
  elsif TG_OP = 'UPDATE' then
    org := coalesce(NEW.org_id, OLD.org_id);
    old_start := OLD.started_at;
    new_start := NEW.started_at;
  else
    org := NEW.org_id;
    new_start := NEW.started_at;
  end if;

  if old_start is not null then
    perform public.time_entry_lock_started_at(org, old_start);
    perform public.time_entry_reject_if_approved_run(org, old_start);
  end if;
  if new_start is not null and new_start is distinct from old_start then
    perform public.time_entry_lock_started_at(org, new_start);
    perform public.time_entry_reject_if_approved_run(org, new_start);
  end if;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

revoke all on function public.time_entries_guard_payroll_window()
  from public, anon, authenticated;

drop trigger if exists time_entries_guard_payroll_window on public.time_entries;
create trigger time_entries_guard_payroll_window
  before insert or update or delete on public.time_entries
  for each row execute function public.time_entries_guard_payroll_window();

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
  perform public.time_entry_reject_if_approved_run(entry.org_id, entry.started_at);

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

revoke all on function public.time_breaks_guard_payroll_window()
  from public, anon, authenticated;

drop trigger if exists time_breaks_guard_payroll_window on public.time_breaks;
create trigger time_breaks_guard_payroll_window
  before insert or update or delete on public.time_breaks
  for each row execute function public.time_breaks_guard_payroll_window();

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

drop trigger if exists clock_events_guard_approved_payroll on public.clock_events;
create trigger clock_events_guard_approved_payroll
  before insert on public.clock_events
  for each row execute function public.clock_events_guard_approved_payroll();

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
    -- Lock the employee before the entry, the same order an employee delete
    -- cascades in, so the two can't deadlock.
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

    -- Restaurant deletes lock the restaurant, then (via set null) employees and
    -- time_entries, then wait for the org lock. Key-share the restaurants first
    -- so this RPC never holds an employee or entry while waiting on one.
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

    -- Restaurant deletes lock the restaurant, then (via set null) employees and
    -- time_entries, then wait for the org lock. Key-share the restaurants first
    -- so this RPC never holds an employee or entry while waiting on one.
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
    perform public.time_entry_reject_if_approved_run(emp.org_id, entry_row.started_at);
  end if;
  perform public.time_entry_reject_if_approved_run(emp.org_id, manager_save_time_entry.new_started_at);

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
  perform public.time_entry_reject_if_approved_run(entry_row.org_id, entry_row.started_at);

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

  -- Punch and shift writers lock their employee row FOR UPDATE and then wait for
  -- the org lock, while a save's payroll_checks foreign keys need FOR KEY SHARE
  -- on those same employees. Taking the key-share locks before the org lock
  -- means a save never holds the org lock while waiting on an employee row, so
  -- the two can't deadlock.
  perform 1
  from public.employees e
  where e.org_id = NEW.org_id
  order by e.id
  for key share;
  -- Same for restaurants (earnings lines reference them): a restaurant delete
  -- holds its row and then waits for the org lock via time_entries' set null.
  perform 1
  from public.restaurants r
  where r.org_id = NEW.org_id
  order by r.id
  for key share;

  -- Held until commit, so no shift or punch can change between this revision
  -- check and the save/approve becoming visible.
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
    NEW.check_date
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
  ) then
    raise exception 'employees are still clocked in from this period: clock them out first';
  end if;

  return NEW;
end;
$$;

revoke all on function public.payroll_runs_guard_shift_revision()
  from public, anon, authenticated;

drop trigger if exists payroll_runs_guard_shift_revision on public.payroll_runs;
create trigger payroll_runs_guard_shift_revision
  before insert or update on public.payroll_runs
  for each row execute function public.payroll_runs_guard_shift_revision();

revoke all on function public.payroll_shift_revision(uuid, date, date, date) from public, anon;
revoke all on function public.manager_save_time_entry(uuid, uuid, uuid, text, timestamptz, timestamptz, jsonb, text) from public, anon;
revoke all on function public.manager_void_time_entry(uuid, text) from public, anon;
revoke all on function public.list_approved_time_clock_windows(uuid) from public, anon;

grant execute on function public.payroll_shift_revision(uuid, date, date, date) to authenticated;
grant execute on function public.manager_save_time_entry(uuid, uuid, uuid, text, timestamptz, timestamptz, jsonb, text) to authenticated;
grant execute on function public.manager_void_time_entry(uuid, text) to authenticated;
grant execute on function public.list_approved_time_clock_windows(uuid) to authenticated;

-- Runs approved before this migration have no stored window, and protection only
-- reads stored windows, so fill them in from each run's frozen settings snapshot
-- (falling back to the check-date hours zone) before the constraint below makes a
-- missing window impossible. The immutability guard forbids changing these
-- columns on approved runs, so it is disabled for this one statement.
alter table public.payroll_runs disable trigger payroll_runs_guard_immutable;

update public.payroll_runs r
set
  time_clock_from = ((r.period_start - 8) + time '00:00') at time zone z.zone,
  time_clock_until = ((r.period_end + 1) + time '00:00') at time zone z.zone
from (
  select
    run.id,
    coalesce(
      nullif(run.settings->>'timeZone', ''),
      public.payroll_hours_time_zone(run.org_id, run.check_date)
    ) as zone
  from public.payroll_runs run
  where run.status = 'approved'
    and run.hours_source = 'time_clock'
    and (run.time_clock_from is null or run.time_clock_until is null)
) z
where r.id = z.id;

alter table public.payroll_runs enable trigger payroll_runs_guard_immutable;

alter table public.payroll_runs
  drop constraint if exists payroll_runs_time_clock_window_check;
alter table public.payroll_runs
  add constraint payroll_runs_time_clock_window_check check (
    hours_source is distinct from 'time_clock'
    or status is distinct from 'approved'
    or (
      time_clock_from is not null
      and time_clock_until is not null
      and time_clock_from < time_clock_until
    )
  );
