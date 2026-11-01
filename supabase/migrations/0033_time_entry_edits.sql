-- Manager/admin correction of closed time-clock shifts before payroll,
-- with a required reason and an audit trail. Additive. Apply with
-- `npm run db:apply`, not db:push.
-- Does not alter clock_events. Edits stay because reconcile_attendance()
-- does not rebuild time_entries.
-- payroll_runs.inputs.shiftRevision is the md5 from payroll_shift_revision;
-- a BEFORE trigger rejects time_clock draft saves and approvals when it is
-- missing or stale. Parameter references are qualified with the function name.

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

create or replace function public.payroll_shift_revision_unchecked(
  target_org_id uuid,
  period_start date,
  period_end date
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
    payroll_shift_revision_unchecked.period_end
  );
  window_start := (
    (payroll_shift_revision_unchecked.period_start - 8) + time '00:00'
  ) at time zone zone;
  window_end := (
    (payroll_shift_revision_unchecked.period_end + 1) + time '00:00'
  ) at time zone zone;

  return md5(
    coalesce(
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

revoke all on function public.payroll_shift_revision_unchecked(uuid, date, date)
  from public, anon, authenticated;

create or replace function public.payroll_shift_revision(
  target_org_id uuid,
  period_start date,
  period_end date
)
returns text
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  if not public.has_org_role(payroll_shift_revision.target_org_id, array['admin']) then
    raise exception 'not authorized';
  end if;

  return public.payroll_shift_revision_unchecked(
    payroll_shift_revision.target_org_id,
    payroll_shift_revision.period_start,
    payroll_shift_revision.period_end
  );
end;
$$;

create or replace function public.list_approved_time_clock_windows(target_org_id uuid)
returns table (
  period_start date,
  period_end date,
  check_date date,
  time_zone text
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
    public.payroll_hours_time_zone(r.org_id, r.period_end)
  from public.payroll_runs r
  where r.org_id = list_approved_time_clock_windows.target_org_id
    and r.status = 'approved'
    and r.hours_source = 'time_clock'
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

create or replace function public.time_entry_lock_payroll_years(
  target_org_id uuid,
  local_dates date[]
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  y integer;
begin
  for y in
    select distinct yr
    from (
      select extract(year from d)::integer as yr
      from unnest(time_entry_lock_payroll_years.local_dates) as d
      where d is not null
      union
      select extract(year from d)::integer + 1
      from unnest(time_entry_lock_payroll_years.local_dates) as d
      where d is not null
    ) years
    order by yr
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(
        time_entry_lock_payroll_years.target_org_id::text || ':' || y::text,
        0
      )
    );
  end loop;
end;
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
    and (
      time_entry_reject_if_approved_run.started_at
      at time zone public.payroll_hours_time_zone(r.org_id, r.period_end)
    )::date between r.period_start and r.period_end
  order by r.check_date, r.id
  limit 1;

  if locked_check is not null then
    raise exception 'shift is in an approved payroll run (check date %): void that run first', locked_check;
  end if;
end;
$$;

revoke all on function public.time_entry_reject_if_approved_run(uuid, timestamptz)
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
    where id = manager_save_time_entry.target_entry_id
    for update;

    if not found then
      raise exception 'time entry not found';
    end if;

    if
      manager_save_time_entry.target_employee_id is not null
      and manager_save_time_entry.target_employee_id is distinct from entry_row.employee_id
    then
      raise exception 'employee cannot be changed';
    end if;

    select * into emp
    from public.employees
    where id = entry_row.employee_id
    for update;

    action := 'update';
    before_snap := public.time_entry_snapshot(entry_row.id);
  else
    if manager_save_time_entry.target_employee_id is null then
      raise exception 'employee is required';
    end if;

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

create or replace function public.payroll_runs_guard_shift_revision()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  expected text;
  provided text;
begin
  if NEW.hours_source is distinct from 'time_clock' then
    return NEW;
  end if;

  if not (
    NEW.status = 'draft'
    or (
      TG_OP = 'UPDATE'
      and OLD.status = 'draft'
      and NEW.status = 'approved'
    )
  ) then
    return NEW;
  end if;

  expected := public.payroll_shift_revision_unchecked(
    NEW.org_id,
    NEW.period_start,
    NEW.period_end
  );
  provided := NEW.inputs->>'shiftRevision';

  if provided is null or provided is distinct from expected then
    raise exception 'shifts changed since this run was calculated: stale, recalculate';
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

revoke all on function public.payroll_shift_revision(uuid, date, date) from public, anon;
revoke all on function public.manager_save_time_entry(uuid, uuid, uuid, text, timestamptz, timestamptz, jsonb, text) from public, anon;
revoke all on function public.manager_void_time_entry(uuid, text) from public, anon;
revoke all on function public.list_approved_time_clock_windows(uuid) from public, anon;

grant execute on function public.payroll_shift_revision(uuid, date, date) to authenticated;
grant execute on function public.manager_save_time_entry(uuid, uuid, uuid, text, timestamptz, timestamptz, jsonb, text) to authenticated;
grant execute on function public.manager_void_time_entry(uuid, text) to authenticated;
grant execute on function public.list_approved_time_clock_windows(uuid) to authenticated;
