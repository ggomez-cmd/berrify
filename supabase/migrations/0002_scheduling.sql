-- Berrify employee scheduling.
-- Idempotent: safe to re-run.

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid unique references auth.users (id) on delete set null,
  full_name text not null,
  email text,
  phone text,
  position text not null default 'Other' check (
    position in ('Server', 'Cook', 'Bartender', 'Host', 'Dish', 'Manager', 'Other')
  ),
  hourly_rate numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_shifts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  employee_id uuid references public.employees (id) on delete set null,
  position text not null default 'Other' check (
    position in ('Server', 'Cook', 'Bartender', 'Host', 'Dish', 'Manager', 'Other')
  ),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'draft' check (status in ('draft', 'published')),
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shifts_ends_after_starts check (ends_at > starts_at)
);

create index if not exists employees_org_id_idx on public.employees (org_id);
create index if not exists employees_email_idx on public.employees (lower(email));
create index if not exists staff_shifts_org_id_idx on public.staff_shifts (org_id);
create index if not exists staff_shifts_employee_id_idx on public.staff_shifts (employee_id);
create index if not exists staff_shifts_starts_at_idx on public.staff_shifts (starts_at);

drop trigger if exists employees_set_updated_at on public.employees;
create trigger employees_set_updated_at
  before update on public.employees
  for each row execute function public.set_updated_at();

drop trigger if exists staff_shifts_set_updated_at on public.staff_shifts;
create trigger staff_shifts_set_updated_at
  before update on public.staff_shifts
  for each row execute function public.set_updated_at();

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
      and role = any(roles)
  );
$$;

-- Invite: matching employee email joins that org as staff instead of a new restaurant.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_org_id uuid;
  invite_emp_id uuid;
  new_org_id uuid;
  org_name text;
begin
  if new.email is not null then
    select e.id, e.org_id
      into invite_emp_id, invite_org_id
    from public.employees e
    where e.user_id is null
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

alter table public.employees enable row level security;
alter table public.staff_shifts enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'employees' and policyname = 'employees_select_member') then
    create policy employees_select_member on public.employees
      for select using (public.is_org_member(org_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'employees' and policyname = 'employees_write_manager') then
    create policy employees_write_manager on public.employees
      for all using (public.has_org_role(org_id, array['owner', 'manager']))
      with check (public.has_org_role(org_id, array['owner', 'manager']));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'staff_shifts' and policyname = 'staff_shifts_select_member') then
    create policy staff_shifts_select_member on public.staff_shifts
      for select using (
        public.is_org_member(org_id)
        and (
          status = 'published'
          or public.has_org_role(org_id, array['owner', 'manager'])
        )
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'staff_shifts' and policyname = 'staff_shifts_write_manager') then
    create policy staff_shifts_write_manager on public.staff_shifts
      for all using (public.has_org_role(org_id, array['owner', 'manager']))
      with check (public.has_org_role(org_id, array['owner', 'manager']));
  end if;
end
$$;

grant select, insert, update, delete on public.employees to authenticated;
grant select, insert, update, delete on public.staff_shifts to authenticated;
