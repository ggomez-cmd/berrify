-- Email invites from Employees. A new login joins a roster only through a
-- matching invite; any other new login gets no restaurant and no access.
-- Admins can see whether an invited employee has signed in yet, and invited
-- employees choose their own kiosk PIN once while setting up their account.
-- Keeps 0038's rule that an invite never overwrites an admin or kiosk membership.
-- Kiosk PIN checks are unchanged: 0040 already refuses staff before any PIN.
-- Apply with `npm run db:apply -- 0041_employee_invites.sql`, not db:push.
-- Does not change existing users, memberships, or organizations.

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
begin
  invite_code_in := nullif(btrim(coalesce(new.raw_user_meta_data->>'invite_code', '')), '');

  if new.email is null or invite_code_in is null then
    return new;
  end if;

  select e.id, e.org_id, e.login_role
    into invite_emp_id, invite_org_id, invite_login_role
  from public.employees e
  where e.user_id is null
    and e.invite_code is not null
    and e.invite_code = invite_code_in
    and e.email is not null
    and lower(e.email) = lower(new.email)
  limit 1;

  if invite_emp_id is null then
    return new;
  end if;

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
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create or replace function public.list_employee_logins()
returns table (employee_id uuid, invited_at timestamptz, last_sign_in_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, u.invited_at, u.last_sign_in_at
  from public.employees e
  join auth.users u on u.id = e.user_id
  where public.has_org_role(e.org_id, array['admin']);
$$;

revoke all on function public.list_employee_logins() from public, anon;
grant execute on function public.list_employee_logins() to authenticated;

-- Invited employees choose their own kiosk PIN while setting up their account.
-- They can set it once; after that only an admin can change it on Employees.
-- PINs are unique in the org, so a taken PIN tells the caller that some
-- coworker uses it. Cap those answers per login so PINs cannot be fished for.

create table if not exists public.clock_pin_setup_attempts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  taken_count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.clock_pin_setup_attempts enable row level security;
revoke all on public.clock_pin_setup_attempts from public, anon, authenticated;

create or replace function public.my_clock_pin_status()
returns table (employee_id uuid, has_pin boolean)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.clock_pin_hash is not null
  from public.employees e
  where e.user_id = auth.uid()
    and e.active
  limit 1;
$$;

revoke all on function public.my_clock_pin_status() from public, anon;
grant execute on function public.my_clock_pin_status() to authenticated;

-- Returns 'set', 'taken' (choose another), or 'locked' (too many taken PINs).
create or replace function public.set_my_clock_pin(pin text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_emp public.employees;
  v_taken integer;
begin
  if auth.uid() is null then
    raise exception 'Not authorized';
  end if;

  perform public.assert_clock_pin_format(pin);

  select * into v_emp
  from public.employees
  where user_id = auth.uid()
    and active
  limit 1
  for update;

  if not found then
    raise exception 'No roster row for this login';
  end if;

  if v_emp.clock_pin_hash is not null then
    raise exception 'PIN already set. Ask your manager to change it.';
  end if;

  -- One PIN change per org at a time, so two setups cannot both claim a PIN.
  perform pg_advisory_xact_lock(hashtextextended('clock_pin:' || v_emp.org_id::text, 0));

  select taken_count into v_taken
  from public.clock_pin_setup_attempts
  where user_id = auth.uid();

  if coalesce(v_taken, 0) >= 5 then
    return 'locked';
  end if;

  if public.kiosk_pin_conflicts(v_emp.org_id, pin, v_emp.id, null) then
    insert into public.clock_pin_setup_attempts (user_id, taken_count)
    values (auth.uid(), 1)
    on conflict (user_id) do update
      set taken_count = public.clock_pin_setup_attempts.taken_count + 1,
          updated_at = now();
    return case when coalesce(v_taken, 0) + 1 >= 5 then 'locked' else 'taken' end;
  end if;

  update public.employees
  set clock_pin_hash = extensions.crypt(pin, extensions.gen_salt('bf'))
  where id = v_emp.id;

  return 'set';
end;
$$;

revoke all on function public.set_my_clock_pin(text) from public, anon;
grant execute on function public.set_my_clock_pin(text) to authenticated;

-- Admins setting a PIN on Employees take the same per-org lock.
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

  perform pg_advisory_xact_lock(hashtextextended('clock_pin:' || v_emp.org_id::text, 0));

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

notify pgrst, 'reload schema';
