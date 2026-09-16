-- Demo Time Clock hours for the last completed org workweek (Payroll worksheet).
-- Idempotent. Does not delete existing punches. Applies with `npm run db:apply`, not db:push.
-- Rows are keyed by stable UUIDs derived from org + demo email + restaurant + shift slot.

insert into public.time_entries (
  id,
  org_id,
  employee_id,
  staff_shift_id,
  restaurant_id,
  position,
  started_at,
  ended_at,
  gross_seconds,
  paid_break_seconds,
  unpaid_break_seconds,
  worked_seconds,
  status
)
select
  overlay(
    overlay(
      md5(
        'berrify-payroll-demo-v1|'
        || org.id::text
        || '|'
        || slot.email
        || '|'
        || slot.slug
        || '|'
        || slot.day_offset::text
        || '|'
        || slot.start_local::text
      )
      placing '4' from 13
    )
    placing 'a' from 17
  )::uuid,
  org.id,
  emp.id,
  null,
  rest.id,
  emp.position,
  slot.started_at,
  slot.ended_at,
  slot.gross_seconds,
  0,
  slot.unpaid_break_seconds,
  slot.gross_seconds - slot.unpaid_break_seconds,
  'pending'
from public.organizations org
cross join lateral (
  select
    timezone(org.timezone, clock_timestamp()) as local_now,
    org.timezone as tz,
    org.workweek_start_dow as start_dow,
    org.workweek_start_time as start_time
) clock
cross join lateral (
  select
    case
      when (extract(dow from clock.local_now)::int - clock.start_dow + 7) % 7 = 0
        and clock.local_now::time < clock.start_time
        then 7
      else (extract(dow from clock.local_now)::int - clock.start_dow + 7) % 7
    end as days_back
) week_math
cross join lateral (
  select
    (
      (
        (date_trunc('day', clock.local_now) - make_interval(days => week_math.days_back))::date
        + clock.start_time
      ) at time zone clock.tz
    ) - interval '7 days' as week_start
) bounds
cross join lateral (
  select *
  from (
    values
      -- Semilla: Marco 5×9h = 45h (5 OT). Sofia 4×6h = 24h. Nina 2×4h = 8h.
      ('cook@berrify.local', 'semilla', 1, time '11:00', time '20:00', 0),
      ('cook@berrify.local', 'semilla', 2, time '11:00', time '20:00', 0),
      ('cook@berrify.local', 'semilla', 3, time '11:00', time '20:00', 0),
      ('cook@berrify.local', 'semilla', 4, time '11:00', time '20:00', 0),
      ('cook@berrify.local', 'semilla', 5, time '11:00', time '20:00', 0),
      ('server@berrify.local', 'semilla', 2, time '10:00', time '16:00', 0),
      ('server@berrify.local', 'semilla', 3, time '10:00', time '16:00', 0),
      ('server@berrify.local', 'semilla', 4, time '10:00', time '16:00', 0),
      ('server@berrify.local', 'semilla', 5, time '10:00', time '16:00', 0),
      ('dish@pacifico.example', 'semilla', 1, time '10:00', time '14:00', 0),
      ('dish@pacifico.example', 'semilla', 2, time '10:00', time '14:00', 0),
      -- Kane: Elena 5×5h = 25h. Luis 4×8h overnight = 32h.
      ('host@pacifico.example', 'kane-rum-bar', 1, time '16:00', time '21:00', 0),
      ('host@pacifico.example', 'kane-rum-bar', 2, time '16:00', time '21:00', 0),
      ('host@pacifico.example', 'kane-rum-bar', 3, time '16:00', time '21:00', 0),
      ('host@pacifico.example', 'kane-rum-bar', 4, time '16:00', time '21:00', 0),
      ('host@pacifico.example', 'kane-rum-bar', 5, time '16:00', time '21:00', 0),
      ('bar@pacifico.example', 'kane-rum-bar', 3, time '16:00', time '00:00', 0),
      ('bar@pacifico.example', 'kane-rum-bar', 4, time '16:00', time '00:00', 0),
      ('bar@pacifico.example', 'kane-rum-bar', 5, time '16:00', time '00:00', 0),
      ('bar@pacifico.example', 'kane-rum-bar', 6, time '16:00', time '00:00', 0)
  ) as v(email, slug, day_offset, start_local, end_local, unpaid_break_seconds)
) spec
cross join lateral (
  select
    spec.email,
    spec.slug,
    spec.day_offset,
    spec.start_local,
    spec.unpaid_break_seconds,
    (
      (
        (timezone(clock.tz, bounds.week_start)::date + spec.day_offset)
        + spec.start_local
      ) at time zone clock.tz
    ) as started_at,
    (
      (
        (timezone(clock.tz, bounds.week_start)::date
          + spec.day_offset
          + case when spec.end_local <= spec.start_local then 1 else 0 end)
        + spec.end_local
      ) at time zone clock.tz
    ) as ended_at
) stamped
cross join lateral (
  select
    stamped.*,
    greatest(0, floor(extract(epoch from (stamped.ended_at - stamped.started_at)))::int) as gross_seconds
) slot
join public.employees emp
  on emp.org_id = org.id
 and emp.email = slot.email
join public.restaurants rest
  on rest.org_id = org.id
 and rest.slug = slot.slug
on conflict (id) do update set
  restaurant_id = excluded.restaurant_id,
  position = excluded.position,
  started_at = excluded.started_at,
  ended_at = excluded.ended_at,
  gross_seconds = excluded.gross_seconds,
  paid_break_seconds = excluded.paid_break_seconds,
  unpaid_break_seconds = excluded.unpaid_break_seconds,
  worked_seconds = excluded.worked_seconds,
  status = excluded.status;
