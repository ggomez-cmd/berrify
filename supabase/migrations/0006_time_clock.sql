-- Berrify Phase 1 time clock.
-- Additive and idempotent. Do not drop invoice tables.

-- ---------------------------------------------------------------------------
-- Organization / location / roster columns
-- ---------------------------------------------------------------------------

alter table public.organizations
  add column if not exists timezone text not null default 'America/Puerto_Rico';
alter table public.organizations
  add column if not exists workweek_start_dow smallint not null default 0;
alter table public.organizations
  add column if not exists workweek_start_time time not null default '00:00';
alter table public.organizations
  add column if not exists default_meal_break_paid boolean not null default false;
alter table public.organizations
  add column if not exists default_rest_break_paid boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'organizations_workweek_start_dow_check'
  ) then
    alter table public.organizations
      add constraint organizations_workweek_start_dow_check
      check (workweek_start_dow between 0 and 6);
  end if;
end
$$;

alter table public.restaurants add column if not exists timezone text;
alter table public.restaurants add column if not exists latitude double precision;
alter table public.restaurants add column if not exists longitude double precision;
alter table public.restaurants add column if not exists geofence_meters integer;

alter table public.employees add column if not exists home_restaurant_id uuid
  references public.restaurants (id) on delete set null;

alter table public.staff_shifts add column if not exists restaurant_id uuid
  references public.restaurants (id) on delete set null;

create index if not exists employees_home_restaurant_id_idx
  on public.employees (home_restaurant_id);
create index if not exists staff_shifts_restaurant_id_idx
  on public.staff_shifts (restaurant_id);

-- ---------------------------------------------------------------------------
-- Immutable clock events
-- ---------------------------------------------------------------------------

create table if not exists public.clock_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  restaurant_id uuid references public.restaurants (id) on delete set null,
  staff_shift_id uuid references public.staff_shifts (id) on delete set null,
  event_type text not null check (event_type in ('clock_in', 'break_start', 'break_end', 'clock_out')),
  actor_type text not null check (actor_type in ('employee', 'manager', 'system')),
  source text not null check (source in ('web', 'mobile', 'kiosk', 'system')),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  client_occurred_at timestamptz,
  client_event_id uuid not null unique,
  note text,
  latitude double precision,
  longitude double precision,
  accuracy_m double precision,
  created_by uuid references auth.users (id) on delete set null
);

create index if not exists clock_events_org_id_idx on public.clock_events (org_id);
create index if not exists clock_events_employee_id_idx on public.clock_events (employee_id, occurred_at);
create index if not exists clock_events_client_event_id_idx on public.clock_events (client_event_id);

-- ---------------------------------------------------------------------------
-- Live-only clock sessions
-- ---------------------------------------------------------------------------

create table if not exists public.clock_sessions (
  employee_id uuid primary key references public.employees (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  restaurant_id uuid references public.restaurants (id) on delete set null,
  staff_shift_id uuid references public.staff_shifts (id) on delete set null,
  state text not null check (state in ('working', 'on_break')),
  clocked_in_at timestamptz not null,
  break_started_at timestamptz,
  clock_in_event_id uuid not null references public.clock_events (id) on delete restrict,
  last_event_id uuid not null references public.clock_events (id) on delete restrict,
  updated_at timestamptz not null default now()
);

create index if not exists clock_sessions_org_id_idx on public.clock_sessions (org_id);

-- ---------------------------------------------------------------------------
-- Derived attendance
-- ---------------------------------------------------------------------------

create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  staff_shift_id uuid references public.staff_shifts (id) on delete set null,
  restaurant_id uuid references public.restaurants (id) on delete set null,
  position text not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  gross_seconds integer not null,
  paid_break_seconds integer not null default 0,
  unpaid_break_seconds integer not null default 0,
  worked_seconds integer not null,
  status text not null default 'pending' check (status in ('pending', 'exception')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_entries_ends_after_starts check (ended_at >= started_at),
  constraint time_entries_worked_identity check (worked_seconds = gross_seconds - unpaid_break_seconds)
);

create index if not exists time_entries_org_id_idx on public.time_entries (org_id);
create index if not exists time_entries_employee_id_idx on public.time_entries (employee_id, started_at);

create table if not exists public.time_breaks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  time_entry_id uuid not null references public.time_entries (id) on delete cascade,
  break_start_event_id uuid references public.clock_events (id) on delete set null,
  break_end_event_id uuid references public.clock_events (id) on delete set null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_seconds integer not null,
  break_type text not null check (break_type in ('meal', 'rest', 'other')),
  paid boolean not null,
  created_at timestamptz not null default now()
);

create index if not exists time_breaks_time_entry_id_idx on public.time_breaks (time_entry_id);

create table if not exists public.time_exceptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  time_entry_id uuid references public.time_entries (id) on delete set null,
  clock_event_id uuid references public.clock_events (id) on delete set null,
  staff_shift_id uuid references public.staff_shifts (id) on delete set null,
  type text not null check (type in (
    'early', 'late', 'missed_in', 'missed_out', 'long_break', 'unscheduled', 'overlap', 'missing_employment_term'
  )),
  delta_seconds integer,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists time_exceptions_org_id_idx on public.time_exceptions (org_id, status);
create index if not exists time_exceptions_employee_id_idx on public.time_exceptions (employee_id);

drop trigger if exists time_entries_set_updated_at on public.time_entries;
create trigger time_entries_set_updated_at
  before update on public.time_entries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.clock_state_from_session(p_state text)
returns text
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_state is null then
    return 'off_clock';
  end if;
  if p_state in ('working', 'on_break') then
    return p_state;
  end if;
  raise exception 'Invalid session state: %', p_state;
end;
$$;

create or replace function public.next_clock_state(p_from text, p_event text)
returns text
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_from = 'off_clock' and p_event = 'clock_in' then
    return 'working';
  elsif p_from = 'working' and p_event = 'break_start' then
    return 'on_break';
  elsif p_from = 'on_break' and p_event = 'break_end' then
    return 'working';
  elsif p_from = 'working' and p_event = 'clock_out' then
    return 'off_clock';
  end if;
  raise exception 'Invalid clock transition: % while %', p_event, p_from;
end;
$$;

create or replace function public.match_published_shift(p_employee_id uuid, p_at timestamptz)
returns public.staff_shifts
language sql
stable
set search_path = public
as $$
  select s.*
  from public.staff_shifts s
  where s.employee_id = p_employee_id
    and s.status = 'published'
    and p_at >= s.starts_at - interval '2 hours'
    and p_at <= s.ends_at + interval '2 hours'
  order by abs(extract(epoch from (s.starts_at - p_at)))
  limit 1;
$$;

create or replace function public.derive_closed_session(
  p_org_id uuid,
  p_employee_id uuid,
  p_clock_in_event_id uuid,
  p_clock_out_event_id uuid,
  p_staff_shift_id uuid,
  p_restaurant_id uuid,
  p_position text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org public.organizations%rowtype;
  v_in public.clock_events%rowtype;
  v_out public.clock_events%rowtype;
  v_shift public.staff_shifts%rowtype;
  v_event public.clock_events%rowtype;
  v_entry_id uuid;
  v_gross integer;
  v_paid integer := 0;
  v_unpaid integer := 0;
  v_open_start timestamptz;
  v_open_start_id uuid;
  v_duration integer;
  v_break_type text;
  v_paid_break boolean;
  v_status text := 'pending';
  v_overlap boolean := false;
  v_delta integer;
begin
  select * into v_org from public.organizations where id = p_org_id;
  select * into v_in from public.clock_events where id = p_clock_in_event_id;
  select * into v_out from public.clock_events where id = p_clock_out_event_id;
  if p_staff_shift_id is not null then
    select * into v_shift from public.staff_shifts where id = p_staff_shift_id;
  end if;

  v_gross := greatest(0, floor(extract(epoch from (v_out.occurred_at - v_in.occurred_at)))::int);

  select exists (
    select 1
    from public.time_entries e
    where e.employee_id = p_employee_id
      and e.started_at < v_out.occurred_at
      and e.ended_at > v_in.occurred_at
  ) into v_overlap;

  insert into public.time_entries (
    org_id, employee_id, staff_shift_id, restaurant_id, position,
    started_at, ended_at, gross_seconds, paid_break_seconds, unpaid_break_seconds,
    worked_seconds, status
  ) values (
    p_org_id, p_employee_id, p_staff_shift_id, p_restaurant_id, p_position,
    v_in.occurred_at, v_out.occurred_at, v_gross, 0, 0, v_gross, 'pending'
  )
  returning id into v_entry_id;

  for v_event in
    select *
    from public.clock_events
    where employee_id = p_employee_id
      and occurred_at >= v_in.occurred_at
      and occurred_at <= v_out.occurred_at
    order by occurred_at, recorded_at
  loop
    if v_event.event_type = 'break_start' then
      v_open_start := v_event.occurred_at;
      v_open_start_id := v_event.id;
    elsif v_event.event_type = 'break_end' and v_open_start is not null then
      v_duration := greatest(0, floor(extract(epoch from (v_event.occurred_at - v_open_start)))::int);
      if v_duration >= 20 * 60 then
        v_break_type := 'meal';
        v_paid_break := v_org.default_meal_break_paid;
      else
        v_break_type := 'rest';
        v_paid_break := v_org.default_rest_break_paid;
      end if;
      insert into public.time_breaks (
        org_id, time_entry_id, break_start_event_id, break_end_event_id,
        started_at, ended_at, duration_seconds, break_type, paid
      ) values (
        p_org_id, v_entry_id, v_open_start_id, v_event.id,
        v_open_start, v_event.occurred_at, v_duration, v_break_type, v_paid_break
      );
      if v_paid_break then
        v_paid := v_paid + v_duration;
      else
        v_unpaid := v_unpaid + v_duration;
      end if;
      v_open_start := null;
      v_open_start_id := null;
    end if;
  end loop;

  update public.time_entries
  set
    paid_break_seconds = v_paid,
    unpaid_break_seconds = v_unpaid,
    worked_seconds = greatest(0, v_gross - v_unpaid)
  where id = v_entry_id;

  if p_staff_shift_id is null then
    insert into public.time_exceptions (org_id, employee_id, time_entry_id, type)
    values (p_org_id, p_employee_id, v_entry_id, 'unscheduled');
    v_status := 'exception';
  elsif v_shift.id is not null then
    v_delta := floor(extract(epoch from (v_in.occurred_at - v_shift.starts_at)))::int;
    if v_delta < -300 then
      insert into public.time_exceptions (org_id, employee_id, time_entry_id, staff_shift_id, type, delta_seconds)
      values (p_org_id, p_employee_id, v_entry_id, p_staff_shift_id, 'early', v_delta);
      v_status := 'exception';
    elsif v_delta > 300 then
      insert into public.time_exceptions (org_id, employee_id, time_entry_id, staff_shift_id, type, delta_seconds)
      values (p_org_id, p_employee_id, v_entry_id, p_staff_shift_id, 'late', v_delta);
      v_status := 'exception';
    end if;
  end if;

  if exists (select 1 from public.time_breaks where time_entry_id = v_entry_id and duration_seconds > 1800) then
    insert into public.time_exceptions (org_id, employee_id, time_entry_id, type)
    values (p_org_id, p_employee_id, v_entry_id, 'long_break');
    v_status := 'exception';
  end if;

  if v_overlap then
    insert into public.time_exceptions (org_id, employee_id, time_entry_id, type)
    values (p_org_id, p_employee_id, v_entry_id, 'overlap');
    v_status := 'exception';
  end if;

  update public.time_entries set status = v_status where id = v_entry_id;
  return v_entry_id;
end;
$$;

create or replace function public.apply_clock_event(
  p_employee public.employees,
  p_event_type text,
  p_actor_type text,
  p_source text,
  p_client_event_id uuid,
  p_note text,
  p_client_occurred_at timestamptz,
  p_occurred_at timestamptz,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision,
  p_created_by uuid
)
returns public.clock_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.clock_sessions%rowtype;
  v_from text;
  v_to text;
  v_now timestamptz := p_occurred_at;
  v_event public.clock_events%rowtype;
  v_existing public.clock_events%rowtype;
  v_shift public.staff_shifts%rowtype;
  v_restaurant_id uuid;
  v_shift_id uuid;
begin
  if p_source is null or p_source not in ('web', 'mobile', 'kiosk', 'system') then
    raise exception 'Invalid clock source';
  end if;
  if p_event_type not in ('clock_in', 'break_start', 'break_end', 'clock_out') then
    raise exception 'Invalid clock event type';
  end if;

  select * into v_existing
  from public.clock_events
  where client_event_id = p_client_event_id;

  if found then
    if v_existing.employee_id <> p_employee.id then
      raise exception 'Duplicate client_event_id';
    end if;
    return v_existing;
  end if;

  select * into v_session
  from public.clock_sessions
  where employee_id = p_employee.id
  for update;

  v_from := public.clock_state_from_session(v_session.state);
  v_to := public.next_clock_state(v_from, p_event_type);

  if p_event_type = 'clock_in' then
    v_shift := public.match_published_shift(p_employee.id, v_now);
    if v_shift.id is not null then
      v_shift_id := v_shift.id;
      v_restaurant_id := coalesce(v_shift.restaurant_id, p_employee.home_restaurant_id);
    else
      v_restaurant_id := p_employee.home_restaurant_id;
    end if;
  else
    v_shift_id := v_session.staff_shift_id;
    v_restaurant_id := v_session.restaurant_id;
  end if;

  insert into public.clock_events (
    org_id, employee_id, restaurant_id, staff_shift_id, event_type, actor_type, source,
    occurred_at, recorded_at, client_occurred_at, client_event_id, note,
    latitude, longitude, accuracy_m, created_by
  ) values (
    p_employee.org_id, p_employee.id, v_restaurant_id, v_shift_id, p_event_type, p_actor_type, p_source,
    v_now, now(), p_client_occurred_at, p_client_event_id, p_note,
    p_latitude, p_longitude, p_accuracy_m, p_created_by
  )
  returning * into v_event;

  if v_to = 'working' and p_event_type = 'clock_in' then
    insert into public.clock_sessions (
      employee_id, org_id, restaurant_id, staff_shift_id, state,
      clocked_in_at, break_started_at, clock_in_event_id, last_event_id, updated_at
    ) values (
      p_employee.id, p_employee.org_id, v_restaurant_id, v_shift_id, 'working',
      v_now, null, v_event.id, v_event.id, now()
    );
  elsif v_to = 'on_break' then
    update public.clock_sessions
    set state = 'on_break',
        break_started_at = v_now,
        last_event_id = v_event.id,
        updated_at = now()
    where employee_id = p_employee.id;
  elsif p_event_type = 'break_end' then
    update public.clock_sessions
    set state = 'working',
        break_started_at = null,
        last_event_id = v_event.id,
        updated_at = now()
    where employee_id = p_employee.id;
  elsif p_event_type = 'clock_out' then
    perform public.derive_closed_session(
      p_employee.org_id,
      p_employee.id,
      v_session.clock_in_event_id,
      v_event.id,
      v_session.staff_shift_id,
      v_session.restaurant_id,
      p_employee.position
    );
    delete from public.clock_sessions where employee_id = p_employee.id;
  end if;

  return v_event;
end;
$$;

create or replace function public.record_clock_event(
  event_type text,
  client_event_id uuid,
  note text default null,
  client_occurred_at timestamptz default null,
  restaurant_id uuid default null, -- accepted, not authoritative; resolve shift then home then null
  latitude double precision default null,
  longitude double precision default null,
  accuracy_m double precision default null,
  source text default 'web'
)
returns public.clock_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee public.employees%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_employee
  from public.employees
  where user_id = auth.uid()
  for update;

  if not found then
    raise exception 'No employee record for this user';
  end if;
  if not v_employee.active then
    raise exception 'Employee is inactive';
  end if;

  return public.apply_clock_event(
    v_employee,
    event_type,
    'employee',
    coalesce(source, 'web'),
    client_event_id,
    note,
    client_occurred_at,
    now(),
    latitude,
    longitude,
    accuracy_m,
    auth.uid()
  );
end;
$$;

create or replace function public.manager_force_clock_out(
  employee_id uuid,
  reason text,
  client_event_id uuid,
  occurred_at timestamptz default now()
)
returns public.clock_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee public.employees%rowtype;
  v_session public.clock_sessions%rowtype;
  v_event public.clock_events%rowtype;
  v_break_id uuid := gen_random_uuid();
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if reason is null or length(trim(reason)) = 0 then
    raise exception 'reason is required';
  end if;

  select * into v_employee
  from public.employees
  where id = manager_force_clock_out.employee_id
  for update;

  if not found then
    raise exception 'Employee not found';
  end if;
  if not public.has_org_role(v_employee.org_id, array['owner', 'manager']) then
    raise exception 'Not authorized';
  end if;

  select * into v_session
  from public.clock_sessions
  where clock_sessions.employee_id = v_employee.id
  for update;

  if not found then
    raise exception 'Employee is not clocked in';
  end if;

  if v_session.state = 'on_break' then
    perform public.apply_clock_event(
      v_employee,
      'break_end',
      'manager',
      'web',
      v_break_id,
      reason,
      null,
      coalesce(occurred_at, now()),
      null, null, null,
      auth.uid()
    );
  end if;

  v_event := public.apply_clock_event(
    v_employee,
    'clock_out',
    'manager',
    'web',
    manager_force_clock_out.client_event_id,
    reason,
    null,
    coalesce(occurred_at, now()),
    null, null, null,
    auth.uid()
  );

  return v_event;
end;
$$;

create or replace function public.manager_record_punch(
  employee_id uuid,
  event_type text,
  occurred_at timestamptz,
  reason text,
  client_event_id uuid
)
returns public.clock_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee public.employees%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if reason is null or length(trim(reason)) = 0 then
    raise exception 'reason is required';
  end if;
  if occurred_at is null then
    raise exception 'occurred_at is required';
  end if;

  select * into v_employee
  from public.employees
  where id = manager_record_punch.employee_id
  for update;

  if not found then
    raise exception 'Employee not found';
  end if;
  if not public.has_org_role(v_employee.org_id, array['owner', 'manager']) then
    raise exception 'Not authorized';
  end if;

  return public.apply_clock_event(
    v_employee,
    manager_record_punch.event_type,
    'manager',
    'web',
    manager_record_punch.client_event_id,
    reason,
    null,
    occurred_at,
    null, null, null,
    auth.uid()
  );
end;
$$;

create or replace function public.list_whos_working()
returns table (
  org_id uuid,
  employee_id uuid,
  full_name text,
  state text,
  clocked_in_at timestamptz,
  restaurant_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.org_id,
    s.employee_id,
    e.full_name,
    s.state,
    case
      when public.has_org_role(s.org_id, array['owner', 'manager']) then s.clocked_in_at
    end as clocked_in_at,
    case
      when public.has_org_role(s.org_id, array['owner', 'manager']) then s.restaurant_id
    end as restaurant_id
  from public.clock_sessions s
  join public.employees e on e.id = s.employee_id
  where public.is_org_member(s.org_id);
$$;

create or replace function public.reconcile_attendance()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_delta integer := 0;
  v_session public.clock_sessions%rowtype;
  v_shift public.staff_shifts%rowtype;
  v_employee public.employees%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  for v_session in
    select s.*
    from public.clock_sessions s
    where public.has_org_role(s.org_id, array['owner', 'manager'])
  loop
    select * into v_employee from public.employees where id = v_session.employee_id;
    if v_session.staff_shift_id is not null then
      select * into v_shift from public.staff_shifts where id = v_session.staff_shift_id;
    else
      v_shift := null;
    end if;

    if (
      (v_shift.id is not null and now() > v_shift.ends_at)
      or extract(epoch from (now() - v_session.clocked_in_at)) >= 12 * 3600
    ) and not exists (
      select 1
      from public.time_exceptions x
      where x.employee_id = v_session.employee_id
        and x.type = 'missed_out'
        and x.status = 'open'
        and x.clock_event_id = v_session.clock_in_event_id
    ) then
      insert into public.time_exceptions (
        org_id, employee_id, clock_event_id, staff_shift_id, type
      ) values (
        v_session.org_id, v_session.employee_id, v_session.clock_in_event_id, v_session.staff_shift_id, 'missed_out'
      );
      v_count := v_count + 1;
    end if;
  end loop;

  insert into public.time_exceptions (org_id, employee_id, staff_shift_id, type)
  select s.org_id, s.employee_id, s.id, 'missed_in'
  from public.staff_shifts s
  where s.status = 'published'
    and s.employee_id is not null
    and s.ends_at < now()
    and s.ends_at >= now() - interval '36 hours'
    and public.has_org_role(s.org_id, array['owner', 'manager'])
    and not exists (
      select 1
      from public.clock_events e
      where e.employee_id = s.employee_id
        and e.event_type = 'clock_in'
        and e.occurred_at >= s.starts_at - interval '2 hours'
        and e.occurred_at <= s.ends_at + interval '2 hours'
    )
    and not exists (
      select 1
      from public.time_exceptions x
      where x.staff_shift_id = s.id
        and x.type = 'missed_in'
    );
  get diagnostics v_delta = row_count;

  return v_count + v_delta;
end;
$$;

create or replace function public.resolve_time_exception(
  exception_id uuid,
  new_status text
)
returns public.time_exceptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.time_exceptions%rowtype;
begin
  if new_status not in ('resolved', 'dismissed') then
    raise exception 'Invalid exception status';
  end if;

  select * into v_row
  from public.time_exceptions
  where id = exception_id
  for update;

  if not found then
    raise exception 'Exception not found';
  end if;
  if not public.has_org_role(v_row.org_id, array['owner', 'manager']) then
    raise exception 'Not authorized';
  end if;

  update public.time_exceptions
  set status = new_status,
      resolved_by = auth.uid(),
      resolved_at = now()
  where id = exception_id
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.update_org_clock_settings(
  timezone text,
  workweek_start_dow smallint,
  workweek_start_time time,
  default_meal_break_paid boolean,
  default_rest_break_paid boolean
)
returns public.organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_org public.organizations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if timezone is null or length(trim(timezone)) = 0 then
    raise exception 'timezone is required';
  end if;
  if workweek_start_dow is null or workweek_start_dow < 0 or workweek_start_dow > 6 then
    raise exception 'workweek_start_dow must be 0-6';
  end if;

  select m.org_id into v_org_id
  from public.memberships m
  where m.user_id = auth.uid()
    and public.has_org_role(m.org_id, array['owner'])
  limit 1;

  if v_org_id is null then
    raise exception 'Not authorized';
  end if;

  update public.organizations
  set
    timezone = update_org_clock_settings.timezone,
    workweek_start_dow = update_org_clock_settings.workweek_start_dow,
    workweek_start_time = update_org_clock_settings.workweek_start_time,
    default_meal_break_paid = update_org_clock_settings.default_meal_break_paid,
    default_rest_break_paid = update_org_clock_settings.default_rest_break_paid
  where id = v_org_id
  returning * into v_org;

  return v_org;
end;
$$;

create or replace function public.guard_org_clock_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    new.timezone is distinct from old.timezone
    or new.workweek_start_dow is distinct from old.workweek_start_dow
    or new.workweek_start_time is distinct from old.workweek_start_time
    or new.default_meal_break_paid is distinct from old.default_meal_break_paid
    or new.default_rest_break_paid is distinct from old.default_rest_break_paid
  ) and not public.has_org_role(new.id, array['owner']) then
    raise exception 'Not authorized to change clock settings';
  end if;
  return new;
end;
$$;

drop trigger if exists organizations_guard_clock_settings on public.organizations;
create trigger organizations_guard_clock_settings
  before update on public.organizations
  for each row execute function public.guard_org_clock_settings();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.clock_events enable row level security;
alter table public.clock_sessions enable row level security;
alter table public.time_entries enable row level security;
alter table public.time_breaks enable row level security;
alter table public.time_exceptions enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'clock_events' and policyname = 'clock_events_select_own') then
    create policy clock_events_select_own on public.clock_events
      for select using (
        employee_id in (select id from public.employees where user_id = auth.uid())
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'clock_events' and policyname = 'clock_events_select_manager') then
    create policy clock_events_select_manager on public.clock_events
      for select using (public.has_org_role(org_id, array['owner', 'manager']));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'clock_sessions' and policyname = 'clock_sessions_select_own') then
    create policy clock_sessions_select_own on public.clock_sessions
      for select using (
        employee_id in (select id from public.employees where user_id = auth.uid())
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'clock_sessions' and policyname = 'clock_sessions_select_manager') then
    create policy clock_sessions_select_manager on public.clock_sessions
      for select using (public.has_org_role(org_id, array['owner', 'manager']));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'time_entries' and policyname = 'time_entries_select_own') then
    create policy time_entries_select_own on public.time_entries
      for select using (
        employee_id in (select id from public.employees where user_id = auth.uid())
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'time_entries' and policyname = 'time_entries_select_manager') then
    create policy time_entries_select_manager on public.time_entries
      for select using (public.has_org_role(org_id, array['owner', 'manager']));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'time_breaks' and policyname = 'time_breaks_select_own') then
    create policy time_breaks_select_own on public.time_breaks
      for select using (
        exists (
          select 1
          from public.time_entries e
          where e.id = time_entry_id
            and e.employee_id in (select id from public.employees where user_id = auth.uid())
        )
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'time_breaks' and policyname = 'time_breaks_select_manager') then
    create policy time_breaks_select_manager on public.time_breaks
      for select using (public.has_org_role(org_id, array['owner', 'manager']));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'time_exceptions' and policyname = 'time_exceptions_select_own') then
    create policy time_exceptions_select_own on public.time_exceptions
      for select using (
        employee_id in (select id from public.employees where user_id = auth.uid())
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'time_exceptions' and policyname = 'time_exceptions_select_manager') then
    create policy time_exceptions_select_manager on public.time_exceptions
      for select using (public.has_org_role(org_id, array['owner', 'manager']));
  end if;
end
$$;

revoke all on table public.clock_events from public, anon, authenticated;
revoke all on table public.clock_sessions from public, anon, authenticated;
revoke all on table public.time_entries from public, anon, authenticated;
revoke all on table public.time_breaks from public, anon, authenticated;
revoke all on table public.time_exceptions from public, anon, authenticated;

grant select on table public.clock_events to authenticated;
grant select on table public.clock_sessions to authenticated;
grant select on table public.time_entries to authenticated;
grant select on table public.time_breaks to authenticated;
grant select on table public.time_exceptions to authenticated;

revoke all on function public.apply_clock_event(public.employees, text, text, text, uuid, text, timestamptz, timestamptz, double precision, double precision, double precision, uuid) from public, anon, authenticated;
revoke all on function public.derive_closed_session(uuid, uuid, uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.clock_state_from_session(text) from public, anon, authenticated;
revoke all on function public.next_clock_state(text, text) from public, anon, authenticated;
revoke all on function public.match_published_shift(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.guard_org_clock_settings() from public, anon, authenticated;

grant execute on function public.record_clock_event(text, uuid, text, timestamptz, uuid, double precision, double precision, double precision, text) to authenticated;
grant execute on function public.manager_force_clock_out(uuid, text, uuid, timestamptz) to authenticated;
grant execute on function public.manager_record_punch(uuid, text, timestamptz, text, uuid) to authenticated;
grant execute on function public.list_whos_working() to authenticated;
grant execute on function public.reconcile_attendance() to authenticated;
grant execute on function public.resolve_time_exception(uuid, text) to authenticated;
grant execute on function public.update_org_clock_settings(text, smallint, time, boolean, boolean) to authenticated;
