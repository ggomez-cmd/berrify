-- save_payroll_employee_setup (0029) is security invoker and reads public.employees,
-- but authenticated has no SELECT on employees (the app reads them through
-- list_employees_full), so every save failed with "permission denied for table
-- employees". Run it as the owner like the other payroll RPCs. The function still
-- raises unless the caller is an admin of the employee's own org.
alter function public.save_payroll_employee_setup(uuid, jsonb, jsonb) security definer;
alter function public.save_payroll_employee_setup(uuid, jsonb, jsonb) set search_path = public, pg_temp;
