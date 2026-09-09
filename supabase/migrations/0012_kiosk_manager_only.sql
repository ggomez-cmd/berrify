-- Shared tablet kiosk is opened by a manager or admin session.
-- Staff punch with their PIN on that already-open screen.
-- Additive. Does not change record_clock_event, manager_record_punch,
-- or apply_clock_event.

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

  if not public.has_org_role(v_emp.org_id, array['admin', 'manager']) then
    raise exception 'Not authorized';
  end if;

  return v_emp;
end;
$$;

revoke all on function public.kiosk_employee_for_pin(text) from public, anon, authenticated;

notify pgrst, 'reload schema';
