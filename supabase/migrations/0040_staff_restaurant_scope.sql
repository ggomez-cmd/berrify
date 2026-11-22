-- Staff restaurant scope. A staff login no longer reads the employee list,
-- and sees only the shifts for its own restaurant.
--
-- employees: admin and manager read every employee in the org as before.
-- Any other member (staff) reads only its own row (user_id = auth.uid()).
-- A kiosk login still reads nothing (is_org_member excludes kiosk, 0038).
--
-- staff_shifts: admin and manager read every shift, drafts included, as
-- before. Staff read published shifts at their employee's home restaurant,
-- plus their own published shifts at any restaurant. Other employees' shifts
-- with no restaurant are hidden. A staff login with no employee row, or
-- whose employee has no home restaurant, sees only its own shifts.
--
-- The staff_shifts policy reads the caller's employee row through
-- shift_visible_to_staff, a security definer function, so it does not go
-- through the employees policy. The employees policies never read
-- staff_shifts, so there is no policy recursion.
--
-- list_shift_coworkers(p_from, p_to) gives the staff Schedule its "Also on"
-- names: employee id and full name for employees with a shift in the range
-- that the caller can already read. Nothing else.
--
-- list_whos_working returns every row to admin and manager as before. Staff
-- get only their own row. The staff app never showed this list.
--
-- Restaurants and organizations are unchanged.
--
-- record_clock_event (self punch) now also requires a current admin, manager
-- or staff membership in the employee's org. A login removed from the org but
-- still linked to an active employee can no longer punch.
--
-- Kiosk PIN functions (kiosk_unlock_v2, kiosk_record_clock_event_v2,
-- kiosk_confirm_exit_v2, kiosk_exit_required) now refuse a caller who is not
-- admin, manager or kiosk somewhere with "Not authorized", before any PIN is
-- compared. That refusal is not counted against the PIN budget. PINs are
-- only compared against orgs where the caller is admin, manager or kiosk, so
-- a staff login gets the same answer for a right and a wrong PIN. Wrong PINs
-- from authorized callers still count as before (0039).
--
-- Apply with `npm run db:apply -- 0040_staff_restaurant_scope.sql`.
-- Check with `npm run verify:staff-scope`.

-- ---------------------------------------------------------------------------
-- Helper: can the caller's own employee row see this shift?
-- ---------------------------------------------------------------------------

create or replace function public.shift_visible_to_staff(
  p_org_id uuid,
  p_restaurant_id uuid,
  p_employee_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.employees e
    where e.user_id = auth.uid()
      and e.org_id = p_org_id
      and (
        e.id = p_employee_id
        or (p_restaurant_id is not null and e.home_restaurant_id = p_restaurant_id)
      )
  );
$$;

revoke all on function public.shift_visible_to_staff(uuid, uuid, uuid) from public, anon;
grant execute on function public.shift_visible_to_staff(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- employees: managers read all, everyone else reads only their own row
-- ---------------------------------------------------------------------------

drop policy if exists employees_select_member on public.employees;
drop policy if exists employees_select_manager on public.employees;
drop policy if exists employees_select_own on public.employees;

create policy employees_select_manager on public.employees
  for select using (public.has_org_role(org_id, array['owner', 'manager']));

create policy employees_select_own on public.employees
  for select using (user_id = auth.uid() and public.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- staff_shifts: managers read all; staff read their restaurant and their own
-- ---------------------------------------------------------------------------

drop policy if exists staff_shifts_select_member on public.staff_shifts;

create policy staff_shifts_select_member on public.staff_shifts
  for select using (
    public.has_org_role(org_id, array['owner', 'manager'])
    or (
      status = 'published'
      and public.is_org_member(org_id)
      and public.shift_visible_to_staff(org_id, restaurant_id, employee_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Coworker names for the staff Schedule
-- ---------------------------------------------------------------------------

create or replace function public.list_shift_coworkers(p_from timestamptz, p_to timestamptz)
returns table (employee_id uuid, full_name text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct e.id as employee_id, e.full_name
  from public.staff_shifts s
  join public.employees e on e.id = s.employee_id and e.org_id = s.org_id
  where s.starts_at < p_to
    and s.ends_at > p_from
    and (
      public.has_org_role(s.org_id, array['owner', 'manager'])
      or (
        s.status = 'published'
        and public.is_org_member(s.org_id)
        and public.shift_visible_to_staff(s.org_id, s.restaurant_id, s.employee_id)
      )
    );
$$;

revoke all on function public.list_shift_coworkers(timestamptz, timestamptz) from public, anon;
grant execute on function public.list_shift_coworkers(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- Who's working: staff get only their own row
-- ---------------------------------------------------------------------------

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
  where public.is_org_member(s.org_id)
    and (
      public.has_org_role(s.org_id, array['owner', 'manager'])
      or e.user_id = auth.uid()
    );
$$;

revoke all on function public.list_whos_working() from public, anon;
grant execute on function public.list_whos_working() to authenticated;

-- ---------------------------------------------------------------------------
-- Self punch: the login must still belong to the employee's org
-- ---------------------------------------------------------------------------

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
  if not public.is_org_member(v_employee.org_id) then
    raise exception 'Not authorized';
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

-- ---------------------------------------------------------------------------
-- Kiosk PIN functions: admin, manager or kiosk only, checked before any PIN
-- ---------------------------------------------------------------------------

create or replace function public.kiosk_assert_caller()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.role in ('admin', 'manager', 'kiosk')
  ) then
    raise exception 'Not authorized';
  end if;
end;
$$;

revoke all on function public.kiosk_assert_caller() from public, anon, authenticated;

create or replace function public.kiosk_employee_for_pin(p_pin text, p_kind text)
returns public.employees
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_emp public.employees;
begin
  perform public.kiosk_assert_caller();
  perform public.assert_clock_pin_format(p_pin);
  perform public.kiosk_assert_pin_budget();

  select e.*
    into v_emp
  from public.employees e
  where e.active
    and e.clock_pin_hash is not null
    and public.has_org_role(e.org_id, array['admin', 'manager', 'kiosk'])
    and e.clock_pin_hash = extensions.crypt(p_pin, e.clock_pin_hash)
  limit 1;

  if not found then
    perform public.kiosk_record_pin_failure(p_kind);
    return null;
  end if;

  return v_emp;
end;
$$;

revoke all on function public.kiosk_employee_for_pin(text, text) from public, anon, authenticated;

create or replace function public.kiosk_confirm_exit_v2(pin text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
begin
  perform public.kiosk_assert_caller();
  perform public.assert_clock_pin_format(pin);
  perform public.kiosk_assert_pin_budget();

  if not exists (
    select 1
    from public.memberships m
    where m.role = 'admin'
      and m.kiosk_exit_pin_hash is not null
      and public.has_org_role(m.org_id, array['admin', 'manager', 'kiosk'])
      and m.kiosk_exit_pin_hash = extensions.crypt(pin, m.kiosk_exit_pin_hash)
  ) then
    perform public.kiosk_record_pin_failure('exit');
    return jsonb_build_object('error', 'Invalid PIN');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.kiosk_confirm_exit_v2(text) from public, anon;
grant execute on function public.kiosk_confirm_exit_v2(text) to authenticated;

create or replace function public.kiosk_exit_required()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.kiosk_assert_caller();
  return exists (
    select 1
    from public.memberships m
    where m.role = 'admin'
      and m.kiosk_exit_pin_hash is not null
      and public.has_org_role(m.org_id, array['admin', 'manager', 'kiosk'])
  );
end;
$$;

revoke all on function public.kiosk_exit_required() from public, anon;
grant execute on function public.kiosk_exit_required() to authenticated;

notify pgrst, 'reload schema';
