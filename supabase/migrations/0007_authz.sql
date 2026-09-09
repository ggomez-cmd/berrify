-- Tighten RLS to match the UI: invoices and QBO config are manager-only,
-- inventory/supplier writes are manager-only, org updates are manager-only,
-- and employee wage/PII columns are hidden from the authenticated role.
-- Additive. Does not drop invoice data.

-- ---------------------------------------------------------------------------
-- Employees: hide wage and contact columns; managers load full rows via RPC
-- ---------------------------------------------------------------------------

revoke select on public.employees from authenticated;
grant select (
  id,
  org_id,
  user_id,
  full_name,
  position,
  active,
  home_restaurant_id,
  created_at,
  updated_at
) on public.employees to authenticated;

create or replace function public.list_employees_full()
returns setof public.employees
language sql
stable
security definer
set search_path = public
as $$
  select e.*
  from public.employees e
  where public.has_org_role(e.org_id, array['owner', 'manager']);
$$;

revoke all on function public.list_employees_full() from public, anon;
grant execute on function public.list_employees_full() to authenticated;

-- ---------------------------------------------------------------------------
-- Organizations: members can read; only managers/owners can update
-- ---------------------------------------------------------------------------

drop policy if exists orgs_update_member on public.organizations;
drop policy if exists orgs_update_manager on public.organizations;
create policy orgs_update_manager on public.organizations
  for update using (public.has_org_role(id, array['owner', 'manager']))
  with check (public.has_org_role(id, array['owner', 'manager']));

-- ---------------------------------------------------------------------------
-- Inventory + suppliers: staff can read; only managers write
-- ---------------------------------------------------------------------------

drop policy if exists suppliers_all_member on public.suppliers;
drop policy if exists suppliers_select_member on public.suppliers;
drop policy if exists suppliers_write_manager on public.suppliers;
create policy suppliers_select_member on public.suppliers
  for select using (public.is_org_member(org_id));
create policy suppliers_write_manager on public.suppliers
  for all using (public.has_org_role(org_id, array['owner', 'manager']))
  with check (public.has_org_role(org_id, array['owner', 'manager']));

drop policy if exists inventory_items_all_member on public.inventory_items;
drop policy if exists inventory_items_select_member on public.inventory_items;
drop policy if exists inventory_items_write_manager on public.inventory_items;
create policy inventory_items_select_member on public.inventory_items
  for select using (public.is_org_member(org_id));
create policy inventory_items_write_manager on public.inventory_items
  for all using (public.has_org_role(org_id, array['owner', 'manager']))
  with check (public.has_org_role(org_id, array['owner', 'manager']));

-- ---------------------------------------------------------------------------
-- Invoices + QBO routing: manager-only
-- ---------------------------------------------------------------------------

drop policy if exists invoices_all_member on public.invoices;
drop policy if exists invoices_manager on public.invoices;
create policy invoices_manager on public.invoices
  for all using (public.has_org_role(org_id, array['owner', 'manager']))
  with check (public.has_org_role(org_id, array['owner', 'manager']));

drop policy if exists invoice_lines_all_member on public.invoice_lines;
drop policy if exists invoice_lines_manager on public.invoice_lines;
create policy invoice_lines_manager on public.invoice_lines
  for all using (public.has_org_role(org_id, array['owner', 'manager']))
  with check (public.has_org_role(org_id, array['owner', 'manager']));

drop policy if exists invoice_expenses_all_member on public.invoice_expense_lines;
drop policy if exists invoice_expenses_manager on public.invoice_expense_lines;
create policy invoice_expenses_manager on public.invoice_expense_lines
  for all using (public.has_org_role(org_id, array['owner', 'manager']))
  with check (public.has_org_role(org_id, array['owner', 'manager']));

drop policy if exists vendor_aliases_all_member on public.vendor_aliases;
drop policy if exists vendor_aliases_manager on public.vendor_aliases;
create policy vendor_aliases_manager on public.vendor_aliases
  for all using (public.has_org_role(org_id, array['owner', 'manager']))
  with check (public.has_org_role(org_id, array['owner', 'manager']));

drop policy if exists account_rules_all_member on public.account_rules;
drop policy if exists account_rules_manager on public.account_rules;
create policy account_rules_manager on public.account_rules
  for all using (public.has_org_role(org_id, array['owner', 'manager']))
  with check (public.has_org_role(org_id, array['owner', 'manager']));

drop policy if exists restaurants_all_member on public.restaurants;
drop policy if exists restaurants_select_member on public.restaurants;
drop policy if exists restaurants_write_manager on public.restaurants;
create policy restaurants_select_member on public.restaurants
  for select using (public.is_org_member(org_id));
create policy restaurants_write_manager on public.restaurants
  for all using (public.has_org_role(org_id, array['owner', 'manager']))
  with check (public.has_org_role(org_id, array['owner', 'manager']));

drop policy if exists restaurant_aliases_all_member on public.restaurant_aliases;
drop policy if exists restaurant_aliases_manager on public.restaurant_aliases;
create policy restaurant_aliases_manager on public.restaurant_aliases
  for all using (public.has_org_role(org_id, array['owner', 'manager']))
  with check (public.has_org_role(org_id, array['owner', 'manager']));
