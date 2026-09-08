-- Hide inventory cost and supplier contacts from staff, and require an
-- invite code (not just a matching email) before signup joins a roster.
-- Additive. Does not drop invoice data.

-- ---------------------------------------------------------------------------
-- Inventory: staff can read stock levels; unit_cost is manager-only
-- ---------------------------------------------------------------------------

revoke select on public.inventory_items from authenticated;
grant select (
  id,
  org_id,
  name,
  sku,
  category,
  unit,
  quantity,
  reorder_level,
  supplier_id,
  created_at,
  updated_at
) on public.inventory_items to authenticated;

create or replace function public.list_inventory_full()
returns setof public.inventory_items
language sql
stable
security definer
set search_path = public
as $$
  select i.*
  from public.inventory_items i
  where public.has_org_role(i.org_id, array['owner', 'manager']);
$$;

revoke all on function public.list_inventory_full() from public, anon;
grant execute on function public.list_inventory_full() to authenticated;

-- ---------------------------------------------------------------------------
-- Suppliers: staff can read names; contacts are manager-only
-- ---------------------------------------------------------------------------

revoke select on public.suppliers from authenticated;
grant select (
  id,
  org_id,
  name,
  created_at,
  updated_at
) on public.suppliers to authenticated;

create or replace function public.list_suppliers_full()
returns setof public.suppliers
language sql
stable
security definer
set search_path = public
as $$
  select s.*
  from public.suppliers s
  where public.has_org_role(s.org_id, array['owner', 'manager']);
$$;

revoke all on function public.list_suppliers_full() from public, anon;
grant execute on function public.list_suppliers_full() to authenticated;

-- ---------------------------------------------------------------------------
-- Employee invites: email match alone is not enough
-- ---------------------------------------------------------------------------

alter table public.employees
  add column if not exists invite_code text;

create unique index if not exists employees_invite_code_uidx
  on public.employees (invite_code)
  where invite_code is not null;

create or replace function public.ensure_employee_invite_code()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.user_id is not null then
    new.invite_code := null;
    return new;
  end if;

  if new.email is null or btrim(new.email) = '' then
    new.invite_code := null;
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.invite_code := encode(extensions.gen_random_bytes(12), 'hex');
    return new;
  end if;

  if new.invite_code is null then
    new.invite_code := encode(extensions.gen_random_bytes(12), 'hex');
    return new;
  end if;

  new.invite_code := old.invite_code;
  return new;
end;
$$;

drop trigger if exists employees_ensure_invite_code on public.employees;
create trigger employees_ensure_invite_code
  before insert or update on public.employees
  for each row execute function public.ensure_employee_invite_code();

update public.employees
set invite_code = null
where user_id is null
  and email is not null
  and btrim(email) <> ''
  and invite_code is null;

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

  if not public.has_org_role(emp.org_id, array['owner', 'manager']) then
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

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_org_id uuid;
  invite_emp_id uuid;
  invite_code_in text;
  new_org_id uuid;
  org_name text;
begin
  invite_code_in := nullif(btrim(coalesce(new.raw_user_meta_data->>'invite_code', '')), '');

  if new.email is not null and invite_code_in is not null then
    select e.id, e.org_id
      into invite_emp_id, invite_org_id
    from public.employees e
    where e.user_id is null
      and e.invite_code is not null
      and e.invite_code = invite_code_in
      and e.email is not null
      and lower(e.email) = lower(new.email)
    limit 1;
  end if;

  if invite_emp_id is not null then
    update public.employees
    set user_id = new.id
    where id = invite_emp_id;

    insert into public.memberships (user_id, org_id, role)
    values (new.id, invite_org_id, 'staff')
    on conflict (user_id, org_id) do nothing;

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
  values (new.id, new_org_id, 'owner');

  return new;
end;
$$;
