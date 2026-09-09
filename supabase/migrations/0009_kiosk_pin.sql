-- Shared tablet kiosk: employee clock PINs. Additive. Does not change
-- record_clock_event or manager_record_punch.

alter table public.employees
  add column if not exists clock_pin_hash text;

revoke select (clock_pin_hash) on public.employees from authenticated;

create or replace function public.assert_clock_pin_format(p_pin text)
returns void
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_pin is null or p_pin !~ '^[0-9]{4,8}$' then
    raise exception 'PIN must be 4 to 8 digits';
  end if;
end;
$$;

revoke all on function public.assert_clock_pin_format(text) from public, anon, authenticated;

create or replace function public.kiosk_employee_for_pin(p_pin text)
returns public.employees
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_emp public.employees;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  perform public.assert_clock_pin_format(p_pin);

  select e.*
    into v_emp
  from public.employees e
  where e.active
    and e.clock_pin_hash is not null
    and public.is_org_member(e.org_id)
    and e.clock_pin_hash = extensions.crypt(p_pin, e.clock_pin_hash)
  limit 1;

  if not found then
    raise exception 'Invalid PIN';
  end if;

  return v_emp;
end;
$$;

revoke all on function public.kiosk_employee_for_pin(text) from public, anon, authenticated;

create or replace function public.set_employee_clock_pin(employee_id uuid, pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_emp public.employees;
  v_other public.employees;
begin
  perform public.assert_clock_pin_format(pin);

  select * into v_emp
  from public.employees
  where id = set_employee_clock_pin.employee_id
  for update;

  if not found then
    raise exception 'Employee not found';
  end if;

  if auth.role() is distinct from 'service_role'
     and not public.has_org_role(v_emp.org_id, array['owner', 'manager']) then
    raise exception 'Not authorized';
  end if;

  for v_other in
    select *
    from public.employees
    where org_id = v_emp.org_id
      and id <> v_emp.id
      and clock_pin_hash is not null
  loop
    if v_other.clock_pin_hash = extensions.crypt(pin, v_other.clock_pin_hash) then
      raise exception 'PIN already in use';
    end if;
  end loop;

  update public.employees
  set clock_pin_hash = extensions.crypt(pin, extensions.gen_salt('bf'))
  where id = v_emp.id;
end;
$$;

revoke all on function public.set_employee_clock_pin(uuid, text) from public, anon;
grant execute on function public.set_employee_clock_pin(uuid, text) to authenticated;
grant execute on function public.set_employee_clock_pin(uuid, text) to service_role;

create or replace function public.kiosk_unlock(pin text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp public.employees;
  v_session public.clock_sessions%rowtype;
begin
  v_emp := public.kiosk_employee_for_pin(pin);

  select * into v_session
  from public.clock_sessions
  where employee_id = v_emp.id;

  return jsonb_build_object(
    'id', v_emp.id,
    'full_name', v_emp.full_name,
    'position', v_emp.position,
    'state', public.clock_state_from_session(v_session.state),
    'clocked_in_at', v_session.clocked_in_at,
    'break_started_at', v_session.break_started_at
  );
end;
$$;

revoke all on function public.kiosk_unlock(text) from public, anon;
grant execute on function public.kiosk_unlock(text) to authenticated;

create or replace function public.kiosk_record_clock_event(
  pin text,
  event_type text,
  client_event_id uuid,
  note text default null
)
returns public.clock_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp public.employees;
begin
  v_emp := public.kiosk_employee_for_pin(pin);

  return public.apply_clock_event(
    v_emp,
    event_type,
    'employee',
    'kiosk',
    client_event_id,
    note,
    now(),
    now(),
    null,
    null,
    null,
    auth.uid()
  );
end;
$$;

revoke all on function public.kiosk_record_clock_event(text, text, uuid, text) from public, anon;
grant execute on function public.kiosk_record_clock_event(text, text, uuid, text) to authenticated;
