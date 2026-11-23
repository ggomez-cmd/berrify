-- Punches come only from the kiosk. record_clock_event (self punch from a
-- phone or computer) now always refuses, for every role, before touching any
-- row. The kiosk RPCs (kiosk_record_clock_event_v2) and manager corrections
-- (manager_record_punch, manager_force_clock_out) are unchanged.
-- The function stays so an old app open on a phone gets a clear message
-- instead of "function not found".
--
-- Managers cannot correct their own time: a manager punch (Record missing
-- punch, Force clock out) or a manual time-entry edit on the caller's own
-- employee row is refused unless the caller is an admin. Guarded on the rows
-- those functions write (clock_events with actor_type 'manager', and
-- time_entry_edits), so every correction path is covered. Kiosk punches are
-- actor_type 'employee' and are not affected. Service-role scripts have no
-- auth.uid() and are not affected.
-- Apply with `npm run db:apply -- 0042_kiosk_only_punches.sql`.
-- Check with `npm run verify:staff-scope` and `npm run verify:time-clock`.

create or replace function public.record_clock_event(
  event_type text,
  client_event_id uuid,
  note text default null,
  client_occurred_at timestamptz default null,
  restaurant_id uuid default null,
  latitude double precision default null,
  longitude double precision default null,
  accuracy_m double precision default null,
  source text default 'web'
)
returns public.clock_events
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Clock in and out at the kiosk.';
end;
$$;

revoke all on function public.record_clock_event(text, uuid, text, timestamptz, uuid, double precision, double precision, double precision, text) from public, anon;
grant execute on function public.record_clock_event(text, uuid, text, timestamptz, uuid, double precision, double precision, double precision, text) to authenticated;

create or replace function public.guard_self_time_correction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  -- Nested: time_entry_edits has no actor_type column.
  if tg_table_name = 'clock_events' then
    if new.actor_type <> 'manager' then
      return new;
    end if;
  end if;
  if exists (
    select 1
    from public.employees e
    where e.id = new.employee_id
      and e.user_id = auth.uid()
  ) and not public.has_org_role(new.org_id, array['admin']) then
    raise exception 'Ask an admin to change your own time.';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_self_time_correction() from public, anon, authenticated;

drop trigger if exists clock_events_guard_self_correction on public.clock_events;
create trigger clock_events_guard_self_correction
  before insert on public.clock_events
  for each row execute function public.guard_self_time_correction();

drop trigger if exists time_entry_edits_guard_self_correction on public.time_entry_edits;
create trigger time_entry_edits_guard_self_correction
  before insert on public.time_entry_edits
  for each row execute function public.guard_self_time_correction();

notify pgrst, 'reload schema';
