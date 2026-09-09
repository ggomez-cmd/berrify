-- Per-owner PIN to leave the shared tablet kiosk. Additive.
-- Does not change record_clock_event, manager_record_punch, or apply_clock_event.

alter table public.memberships
  add column if not exists kiosk_exit_pin_hash text;

revoke select on public.memberships from authenticated;
grant select (user_id, org_id, role, created_at) on public.memberships to authenticated;
revoke select (kiosk_exit_pin_hash) on public.memberships from authenticated;

create or replace function public.kiosk_pin_conflicts(
  p_org_id uuid,
  p_pin text,
  p_except_employee_id uuid default null,
  p_except_user_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_emp public.employees;
  v_mem public.memberships;
begin
  for v_emp in
    select *
    from public.employees
    where org_id = p_org_id
      and clock_pin_hash is not null
      and (p_except_employee_id is null or id <> p_except_employee_id)
  loop
    if v_emp.clock_pin_hash = extensions.crypt(p_pin, v_emp.clock_pin_hash) then
      return true;
    end if;
  end loop;

  for v_mem in
    select *
    from public.memberships
    where org_id = p_org_id
      and role = 'owner'
      and kiosk_exit_pin_hash is not null
      and (p_except_user_id is null or user_id <> p_except_user_id)
  loop
    if v_mem.kiosk_exit_pin_hash = extensions.crypt(p_pin, v_mem.kiosk_exit_pin_hash) then
      return true;
    end if;
  end loop;

  return false;
end;
$$;

revoke all on function public.kiosk_pin_conflicts(uuid, text, uuid, uuid) from public, anon, authenticated;

create or replace function public.set_employee_clock_pin(employee_id uuid, pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_emp public.employees;
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

  if public.kiosk_pin_conflicts(v_emp.org_id, pin, v_emp.id, null) then
    raise exception 'PIN already in use';
  end if;

  update public.employees
  set clock_pin_hash = extensions.crypt(pin, extensions.gen_salt('bf'))
  where id = v_emp.id;
end;
$$;

revoke all on function public.set_employee_clock_pin(uuid, text) from public, anon;
grant execute on function public.set_employee_clock_pin(uuid, text) to authenticated;
grant execute on function public.set_employee_clock_pin(uuid, text) to service_role;

create or replace function public.set_owner_kiosk_pin(pin text, user_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid;
  v_org uuid;
begin
  perform public.assert_clock_pin_format(pin);

  if auth.role() = 'service_role' then
    v_user := set_owner_kiosk_pin.user_id;
  else
    v_user := auth.uid();
  end if;

  if v_user is null then
    raise exception 'Not authorized';
  end if;

  select org_id into v_org
  from public.memberships
  where memberships.user_id = v_user
    and role = 'owner'
  for update
  limit 1;

  if v_org is null then
    raise exception 'Not authorized';
  end if;

  if public.kiosk_pin_conflicts(v_org, pin, null, v_user) then
    raise exception 'PIN already in use';
  end if;

  update public.memberships
  set kiosk_exit_pin_hash = extensions.crypt(pin, extensions.gen_salt('bf'))
  where memberships.user_id = v_user
    and org_id = v_org
    and role = 'owner';
end;
$$;

revoke all on function public.set_owner_kiosk_pin(text, uuid) from public, anon;
grant execute on function public.set_owner_kiosk_pin(text, uuid) to authenticated;
grant execute on function public.set_owner_kiosk_pin(text, uuid) to service_role;

create or replace function public.kiosk_exit_required()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.role = 'owner'
      and m.kiosk_exit_pin_hash is not null
      and public.is_org_member(m.org_id)
  );
$$;

revoke all on function public.kiosk_exit_required() from public, anon;
grant execute on function public.kiosk_exit_required() to authenticated;

create or replace function public.kiosk_confirm_exit(pin text)
returns void
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  perform public.assert_clock_pin_format(pin);

  if not exists (
    select 1
    from public.memberships m
    where m.role = 'owner'
      and m.kiosk_exit_pin_hash is not null
      and public.is_org_member(m.org_id)
      and m.kiosk_exit_pin_hash = extensions.crypt(pin, m.kiosk_exit_pin_hash)
  ) then
    raise exception 'Invalid PIN';
  end if;
end;
$$;

revoke all on function public.kiosk_confirm_exit(text) from public, anon;
grant execute on function public.kiosk_confirm_exit(text) to authenticated;

notify pgrst, 'reload schema';
