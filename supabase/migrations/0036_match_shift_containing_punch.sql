-- A clock-in matches the published shift it falls inside before any shift
-- that merely starts closer. Back-to-back shifts at two restaurants no longer
-- charge a late punch to the next restaurant. Grace window and tie-break by
-- nearest start are unchanged. A shift filed under another organization than
-- the employee's never matches.
-- Apply with `npm run db:apply -- 0036_match_shift_containing_punch.sql`.
-- Check with `npm run verify:shift-match -- --migration supabase/migrations/0036_match_shift_containing_punch.sql`

create or replace function public.match_published_shift(p_employee_id uuid, p_at timestamptz)
returns public.staff_shifts
language sql
stable
set search_path = public
as $$
  select s.*
  from public.staff_shifts s
  join public.employees e on e.id = s.employee_id and e.org_id = s.org_id
  where s.employee_id = p_employee_id
    and s.status = 'published'
    and p_at >= s.starts_at - interval '2 hours'
    and p_at <= s.ends_at + interval '2 hours'
  order by
    (p_at >= s.starts_at and p_at < s.ends_at) desc,
    abs(extract(epoch from (s.starts_at - p_at)))
  limit 1;
$$;
