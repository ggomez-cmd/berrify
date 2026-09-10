-- Rename membership role owner → admin, let admins create manager/staff
-- accounts, and hide inventory from staff. Additive. Does not drop invoice
-- data. Does not change record_clock_event, manager_record_punch, or
-- apply_clock_event.

-- ---------------------------------------------------------------------------
-- memberships.role: owner → admin
-- ---------------------------------------------------------------------------

alter table public.memberships drop constraint if exists memberships_role_check;

update public.memberships
set role = 'admin'
where role = 'owner';

alter table public.memberships
  alter column role set default 'admin';

alter table public.memberships
  add constraint memberships_role_check check (role in ('admin', 'manager', 'staff'));

-- Existing RPCs and policies still pass array['owner', ...]. Treat stored
-- admin as a match for requested owner so 0006 punch functions stay untouched.
create or replace function public.has_org_role(check_org_id uuid, roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships
    where user_id = auth.uid()
      and org_id = check_org_id
      and (
        role = any(roles)
        or (role = 'admin' and 'owner' = any(roles))
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- employees.login_role: manager or staff (never admin)
-- ---------------------------------------------------------------------------

alter table public.employees
  add column if not exists login_role text not null default 'staff';

alter table public.employees drop constraint if exists employees_login_role_check;
alter table public.employees
  add constraint employees_login_role_check check (login_role in ('manager', 'staff'));

create or replace function public.sync_employee_login_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is not null then
    update public.memberships m
    set role = new.login_role
    where m.user_id = new.user_id
      and m.org_id = new.org_id
      and m.role <> 'admin';
  end if;
  return new;
end;
$$;

drop trigger if exists employees_sync_login_role on public.employees;
create trigger employees_sync_login_role
  after insert or update of login_role, user_id
  on public.employees
  for each row execute function public.sync_employee_login_role();

-- Invite join uses the roster login_role. Public signup still bootstraps a
-- new org as admin.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_org_id uuid;
  invite_emp_id uuid;
  invite_login_role text;
  invite_code_in text;
  new_org_id uuid;
  org_name text;
begin
  invite_code_in := nullif(btrim(coalesce(new.raw_user_meta_data->>'invite_code', '')), '');

  if new.email is not null and invite_code_in is not null then
    select e.id, e.org_id, e.login_role
      into invite_emp_id, invite_org_id, invite_login_role
    from public.employees e
    where e.user_id is null
      and e.invite_code is not null
      and e.invite_code = invite_code_in
      and e.email is not null
      and lower(e.email) = lower(new.email)
    limit 1;
  end if;

  if invite_emp_id is not null then
    if invite_login_role not in ('manager', 'staff') then
      invite_login_role := 'staff';
    end if;

    update public.employees
    set user_id = new.id
    where id = invite_emp_id;

    insert into public.memberships (user_id, org_id, role)
    values (new.id, invite_org_id, invite_login_role)
    on conflict (user_id, org_id) do update
      set role = excluded.role
      where public.memberships.role <> 'admin';

    return new;
  end if;

  org_name := coalesce(
    new.raw_user_meta_data->>'org_name',
    split_part(coalesce(new.email, 'restaurant'), '@', 1) || '''s restaurant'
  );

  insert into public.organizations (name)
  values (org_name)
  returning id into new_org_id;

  insert into public.memberships (user_id, org_id, role)
  values (new.id, new_org_id, 'admin');

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Account writes (roster, pay, invite rotate, clock PIN): admin only
-- ---------------------------------------------------------------------------

drop policy if exists employees_write_manager on public.employees;
drop policy if exists employees_write_admin on public.employees;
create policy employees_write_admin on public.employees
  for all using (public.has_org_role(org_id, array['admin']))
  with check (public.has_org_role(org_id, array['admin']));

create or replace function public.rotate_employee_invite(target_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  emp public.employees;
  new_code text;
begin
  select * into emp
  from public.employees
  where id = target_id;

  if not found then
    raise exception 'employee not found';
  end if;

  if not public.has_org_role(emp.org_id, array['admin']) then
    raise exception 'not authorized';
  end if;

  if emp.user_id is not null then
    raise exception 'employee already linked';
  end if;

  if emp.email is null or btrim(emp.email) = '' then
    raise exception 'employee email required for invite';
  end if;

  update public.employees
  set invite_code = null
  where id = target_id
  returning invite_code into new_code;

  return new_code;
end;
$$;

revoke all on function public.rotate_employee_invite(uuid) from public, anon;
grant execute on function public.rotate_employee_invite(uuid) to authenticated;

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
     and not public.has_org_role(v_emp.org_id, array['admin']) then
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

-- ---------------------------------------------------------------------------
-- Inventory, suppliers, movements: admin + manager only
-- ---------------------------------------------------------------------------

drop policy if exists inventory_items_select_member on public.inventory_items;
drop policy if exists inventory_items_select_manager on public.inventory_items;
create policy inventory_items_select_manager on public.inventory_items
  for select using (public.has_org_role(org_id, array['admin', 'manager']));

drop policy if exists suppliers_select_member on public.suppliers;
drop policy if exists suppliers_select_manager on public.suppliers;
create policy suppliers_select_manager on public.suppliers
  for select using (public.has_org_role(org_id, array['admin', 'manager']));

drop policy if exists stock_movements_select_member on public.stock_movements;
drop policy if exists stock_movements_insert_member on public.stock_movements;
drop policy if exists stock_movements_select_manager on public.stock_movements;
drop policy if exists stock_movements_insert_manager on public.stock_movements;
create policy stock_movements_select_manager on public.stock_movements
  for select using (public.has_org_role(org_id, array['admin', 'manager']));
create policy stock_movements_insert_manager on public.stock_movements
  for insert with check (public.has_org_role(org_id, array['admin', 'manager']));

-- ---------------------------------------------------------------------------
-- Kiosk exit PIN lives on admin memberships
-- ---------------------------------------------------------------------------

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
      and role = 'admin'
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
    and role = 'admin'
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
    and role = 'admin';
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
    where m.role = 'admin'
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
    where m.role = 'admin'
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
