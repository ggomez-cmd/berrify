-- Kiosk membership role: a shared tablet login that can only run the Kiosk
-- screen. Staff punch on it with their clock PIN.
--
-- A kiosk login is not an org member for RLS. is_org_member now excludes
-- role 'kiosk', so every member-wide policy and RPC (employees, staff_shifts,
-- restaurants, organizations update, list_whos_working) keeps admin, manager
-- and staff exactly as before and denies kiosk by default. has_org_role is
-- unchanged and only matches 'kiosk' where a caller lists it, which only the
-- kiosk RPCs below do. A kiosk login can read its own membership row
-- (memberships_select_own) and its organization row (name and time zone for
-- the screen). Nothing else.
--
-- Kiosk accounts have no employee row. employees.login_role stays
-- manager/staff, the login_role sync and invite join never overwrite a kiosk
-- membership, and linking an employee to a kiosk login is refused.
--
-- Does not change apply_clock_event, record_clock_event, or
-- manager_record_punch.
-- Apply with `npm run db:apply -- 0038_kiosk_role.sql`.
-- Check with `npm run verify:kiosk-role`.

alter table public.memberships drop constraint if exists memberships_role_check;
alter table public.memberships
  add constraint memberships_role_check check (role in ('admin', 'manager', 'staff', 'kiosk'));

-- ---------------------------------------------------------------------------
-- RLS helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_org_member(check_org_id uuid)
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
      and role <> 'kiosk'
  );
$$;

create or replace function public.is_org_kiosk(check_org_id uuid)
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
      and role = 'kiosk'
  );
$$;

revoke all on function public.is_org_kiosk(uuid) from public, anon;
grant execute on function public.is_org_kiosk(uuid) to authenticated;

drop policy if exists orgs_select_kiosk on public.organizations;
create policy orgs_select_kiosk on public.organizations
  for select using (public.is_org_kiosk(id));

-- ---------------------------------------------------------------------------
-- Kiosk RPCs accept the kiosk login alongside admin and manager
-- ---------------------------------------------------------------------------

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
    and (public.is_org_member(e.org_id) or public.is_org_kiosk(e.org_id))
    and e.clock_pin_hash = extensions.crypt(p_pin, e.clock_pin_hash)
  limit 1;

  if not found then
    raise exception 'Invalid PIN';
  end if;

  if not public.has_org_role(v_emp.org_id, array['admin', 'manager', 'kiosk']) then
    raise exception 'Not authorized';
  end if;

  return v_emp;
end;
$$;

revoke all on function public.kiosk_employee_for_pin(text) from public, anon, authenticated;

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
      and (public.is_org_member(m.org_id) or public.is_org_kiosk(m.org_id))
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
      and (public.is_org_member(m.org_id) or public.is_org_kiosk(m.org_id))
      and m.kiosk_exit_pin_hash = extensions.crypt(pin, m.kiosk_exit_pin_hash)
  ) then
    raise exception 'Invalid PIN';
  end if;
end;
$$;

revoke all on function public.kiosk_confirm_exit(text) from public, anon;
grant execute on function public.kiosk_confirm_exit(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Keep kiosk memberships kiosk
-- ---------------------------------------------------------------------------

-- A kiosk membership is the account's only membership, and its login has no
-- employee row. Otherwise a leftover admin membership (signup bootstraps one)
-- or an old employee link would keep access the kiosk login must not have.
create or replace function public.guard_kiosk_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'kiosk' then
    if exists (
      select 1 from public.memberships m
      where m.user_id = new.user_id and m.org_id <> new.org_id
    ) then
      raise exception 'A kiosk login must have no other memberships';
    end if;
    if exists (select 1 from public.employees e where e.user_id = new.user_id) then
      raise exception 'A kiosk login cannot be linked to an employee';
    end if;
  elsif exists (
    select 1 from public.memberships m
    where m.user_id = new.user_id and m.org_id <> new.org_id and m.role = 'kiosk'
  ) then
    raise exception 'A kiosk login must have no other memberships';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_kiosk_membership() from public, anon, authenticated;

drop trigger if exists memberships_guard_kiosk on public.memberships;
create trigger memberships_guard_kiosk
  before insert or update of role, user_id, org_id
  on public.memberships
  for each row execute function public.guard_kiosk_membership();

create or replace function public.sync_employee_login_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is not null then
    if exists (
      select 1
      from public.memberships m
      where m.user_id = new.user_id
        and m.role = 'kiosk'
    ) then
      raise exception 'A kiosk login cannot be linked to an employee';
    end if;

    update public.memberships m
    set role = new.login_role
    where m.user_id = new.user_id
      and m.org_id = new.org_id
      and m.role <> 'admin';
  end if;
  return new;
end;
$$;

revoke execute on function public.sync_employee_login_role() from public, anon, authenticated;

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
      where public.memberships.role not in ('admin', 'kiosk');

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

revoke execute on function public.handle_new_user() from public, anon, authenticated;

notify pgrst, 'reload schema';
