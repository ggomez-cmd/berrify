-- Only a kiosk login can run the Kiosk. Admin and manager logins can no longer
-- unlock, punch, or exit the kiosk, so the kiosk cannot be opened on a
-- manager's own phone and used with an employee's PIN.
--
-- Every kiosk RPC (kiosk_unlock_v2, kiosk_record_clock_event_v2,
-- kiosk_confirm_exit_v2, kiosk_exit_required, and kiosk_employee_for_pin
-- under them) calls kiosk_assert_caller before any PIN check, so this one
-- function closes all of them. A refused caller gets "Not authorized" and no
-- PIN failure is recorded.
--
-- Unchanged: manager corrections (manager_record_punch,
-- manager_force_clock_out), the admin exit PIN, and set_owner_kiosk_pin.
-- Apply with `npm run db:apply -- 0043_kiosk_login_only.sql`.
-- Check with `npm run verify:staff-scope`, `npm run verify:kiosk-role` and
-- `npm run verify:kiosk-pin-limit`.

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
      and m.role = 'kiosk'
  ) then
    raise exception 'Not authorized';
  end if;
end;
$$;

revoke all on function public.kiosk_assert_caller() from public, anon, authenticated;

notify pgrst, 'reload schema';
