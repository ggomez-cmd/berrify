-- The project contains legacy scheduling/payroll tables that are not part of
-- Berrify's current organization-scoped schema. They must not remain exposed
-- through PostgREST, especially public.users.password_hash.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'additional_work',
    'app_settings',
    'attendance_events',
    'audit_logs',
    'clients',
    'correction_requests',
    'employee_approvals',
    'location_shift_slots',
    'locations',
    'meal_periods',
    'notifications',
    'officers',
    'payable_shift_records',
    'payroll_adjustments',
    'payroll_employee_records',
    'payroll_periods',
    'permissions',
    'role_permissions',
    'roles',
    'secure_review_tokens',
    'shift_assignments',
    'shift_exceptions',
    'shifts',
    'timesheet_entries',
    'timesheet_versions',
    'timesheets',
    'user_roles',
    'users'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('alter table public.%I enable row level security', table_name);
      execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    end if;
  end loop;
end
$$;

-- These functions are not public endpoints. Trigger execution is unaffected
-- by revoking EXECUTE from the API roles.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- These SECURITY DEFINER routines are trigger targets, not Data API endpoints.
-- Trigger execution does not require EXECUTE privileges, so keep them out of
-- the authenticated RPC surface as an additional defense-in-depth measure.
revoke execute on function public.apply_stock_movement() from public, anon, authenticated;
revoke execute on function public.sync_employee_login_role() from public, anon, authenticated;
revoke execute on function public.has_org_role(uuid, text[]) from public, anon;
revoke execute on function public.is_org_member(uuid) from public, anon;

-- The browser uses a signed-in Supabase session. Anonymous clients should not
-- receive table or RPC privileges, even when an RLS policy would reject them.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from public, anon;

alter function public.set_updated_at() set search_path = public, pg_temp;
alter function public.protect_empty_bottle_event_status() set search_path = public, pg_temp;
