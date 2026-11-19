-- Publish a restaurant's drafts with the restaurant checked at publish time,
-- not when the board loaded. A draft whose restaurant changed since (for
-- example its employee moved home restaurant) is skipped, and the caller
-- refreshes. p_restaurant_id null publishes the given drafts in any
-- restaurant. Runs as the caller, so staff_shifts RLS still limits writes to
-- managers and admins of the shift's organization.
-- Apply with `npm run db:apply -- 0037_publish_shifts_for_restaurant.sql`.
-- Check with `npm run verify:publish-shifts`.

create or replace function public.publish_shifts(p_ids uuid[], p_restaurant_id uuid default null)
returns integer
language sql
security invoker
set search_path = public
as $$
  with published as (
    update public.staff_shifts s
    set status = 'published'
    where s.id = any(p_ids)
      and s.status = 'draft'
      and (
        p_restaurant_id is null
        or coalesce(
          s.restaurant_id,
          (select e.home_restaurant_id from public.employees e where e.id = s.employee_id and e.org_id = s.org_id)
        ) = p_restaurant_id
      )
    returning 1
  )
  select count(*)::integer from published;
$$;

revoke all on function public.publish_shifts(uuid[], uuid) from public, anon;
grant execute on function public.publish_shifts(uuid[], uuid) to authenticated;
