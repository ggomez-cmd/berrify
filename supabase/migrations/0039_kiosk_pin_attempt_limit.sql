-- Kiosk PIN attempt limit. A signed-in tablet session (kiosk login, manager
-- or admin) gets 5 wrong PINs per 10 minutes, counted across kiosk_unlock,
-- kiosk_record_clock_event and kiosk_confirm_exit together. Once 5 wrong PINs
-- fall inside the last 10 minutes, every PIN check is refused, even a correct
-- PIN, until the oldest of those 5 is 10 minutes old.
--
-- A wrong PIN used to raise, which rolled back anything the call wrote, so a
-- failure could never be recorded. The three RPCs now record the failure and
-- return {"error": "Invalid PIN"} instead of raising. On success
-- kiosk_unlock returns the same object as before, kiosk_record_clock_event
-- returns the clock_events row as jsonb, and kiosk_confirm_exit returns
-- {"ok": true}. Other errors (not signed in, PIN format, not authorized,
-- locked out, punch rules) still raise; none of them are PIN guesses.
--
-- A correct PIN does not clear earlier failures. On a shared tablet the next
-- person's correct PIN must not wipe a guesser's tally, and anyone who knows
-- one PIN could otherwise reset the budget between guesses.
--
-- One guess is checked against every organization the caller belongs to, so
-- a failure is recorded for each of the caller's organizations and the
-- budget is per login. Other logins are unaffected. kiosk_pin_failures stores
-- no PIN, has RLS on with no policies, and only the security definer
-- functions below read or write it.
--
-- Deploy the frontend that reads the new return shapes with this migration.
-- Apply with `npm run db:apply -- 0039_kiosk_pin_attempt_limit.sql`.
-- Check with `npm run verify:kiosk-pin-limit`.

create table if not exists public.kiosk_pin_failures (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  check_kind text not null check (check_kind in ('unlock', 'punch', 'exit')),
  failed_at timestamptz not null default now()
);

create index if not exists kiosk_pin_failures_user_failed_at
  on public.kiosk_pin_failures (user_id, failed_at desc);

alter table public.kiosk_pin_failures enable row level security;
revoke all on table public.kiosk_pin_failures from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Budget helpers
-- ---------------------------------------------------------------------------

-- Raises while the caller is locked out. Takes a per-login transaction lock
-- first so parallel requests cannot all pass the count before any records.
create or replace function public.kiosk_assert_pin_budget()
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_limit constant integer := 5;
  v_window constant interval := interval '10 minutes';
  v_oldest timestamptz;
  v_minutes integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('kiosk_pin:' || auth.uid()::text, 0));

  select f.failed_at
    into v_oldest
  from public.kiosk_pin_failures f
  where f.user_id = auth.uid()
    and f.failed_at > now() - v_window
  order by f.failed_at desc
  offset v_limit - 1
  limit 1;

  if v_oldest is not null then
    v_minutes := greatest(1, ceil(extract(epoch from (v_oldest + v_window - now())) / 60)::integer);
    raise exception 'Too many wrong PINs. Try again in % %.',
      v_minutes, case when v_minutes = 1 then 'minute' else 'minutes' end;
  end if;
end;
$$;

revoke all on function public.kiosk_assert_pin_budget() from public, anon, authenticated;

create or replace function public.kiosk_record_pin_failure(p_kind text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  insert into public.kiosk_pin_failures (user_id, org_id, check_kind)
  select auth.uid(), m.org_id, p_kind
  from public.memberships m
  where m.user_id = auth.uid();

  delete from public.kiosk_pin_failures
  where user_id = auth.uid()
    and failed_at < now() - interval '1 day';
end;
$$;

revoke all on function public.kiosk_record_pin_failure(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- PIN lookup: returns a null row on a wrong PIN instead of raising
-- ---------------------------------------------------------------------------

create or replace function public.kiosk_employee_for_pin(p_pin text, p_kind text)
returns public.employees
language plpgsql
volatile
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
  perform public.kiosk_assert_pin_budget();

  select e.*
    into v_emp
  from public.employees e
  where e.active
    and e.clock_pin_hash is not null
    and (public.is_org_member(e.org_id) or public.is_org_kiosk(e.org_id))
    and e.clock_pin_hash = extensions.crypt(p_pin, e.clock_pin_hash)
  limit 1;

  if not found then
    perform public.kiosk_record_pin_failure(p_kind);
    return null;
  end if;

  if not public.has_org_role(v_emp.org_id, array['admin', 'manager', 'kiosk']) then
    raise exception 'Not authorized';
  end if;

  return v_emp;
end;
$$;

revoke all on function public.kiosk_employee_for_pin(text, text) from public, anon, authenticated;

drop function if exists public.kiosk_employee_for_pin(text);

-- ---------------------------------------------------------------------------
-- Kiosk RPCs
-- ---------------------------------------------------------------------------

create or replace function public.kiosk_unlock(pin text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_emp public.employees;
  v_session public.clock_sessions%rowtype;
begin
  v_emp := public.kiosk_employee_for_pin(pin, 'unlock');
  if v_emp.id is null then
    return jsonb_build_object('error', 'Invalid PIN');
  end if;

  select * into v_session
  from public.clock_sessions
  where employee_id = v_emp.id;

  return jsonb_build_object(
    'id', v_emp.id,
    'full_name', v_emp.full_name,
    'position', v_emp.position,
    'state', public.clock_state_from_session(v_session.state),
    'clocked_in_at', v_session.clocked_in_at,
    'break_started_at', v_session.break_started_at
  );
end;
$$;

revoke all on function public.kiosk_unlock(text) from public, anon;
grant execute on function public.kiosk_unlock(text) to authenticated;

drop function if exists public.kiosk_record_clock_event(text, text, uuid, text);

create function public.kiosk_record_clock_event(
  pin text,
  event_type text,
  client_event_id uuid,
  note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_emp public.employees;
begin
  v_emp := public.kiosk_employee_for_pin(pin, 'punch');
  if v_emp.id is null then
    return jsonb_build_object('error', 'Invalid PIN');
  end if;

  return to_jsonb(public.apply_clock_event(
    v_emp,
    event_type,
    'employee',
    'kiosk',
    client_event_id,
    note,
    now(),
    now(),
    null,
    null,
    null,
    auth.uid()
  ));
end;
$$;

revoke all on function public.kiosk_record_clock_event(text, text, uuid, text) from public, anon;
grant execute on function public.kiosk_record_clock_event(text, text, uuid, text) to authenticated;

drop function if exists public.kiosk_confirm_exit(text);

create function public.kiosk_confirm_exit(pin text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  perform public.assert_clock_pin_format(pin);
  perform public.kiosk_assert_pin_budget();

  if not exists (
    select 1
    from public.memberships m
    where m.role = 'admin'
      and m.kiosk_exit_pin_hash is not null
      and (public.is_org_member(m.org_id) or public.is_org_kiosk(m.org_id))
      and m.kiosk_exit_pin_hash = extensions.crypt(pin, m.kiosk_exit_pin_hash)
  ) then
    perform public.kiosk_record_pin_failure('exit');
    return jsonb_build_object('error', 'Invalid PIN');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.kiosk_confirm_exit(text) from public, anon;
grant execute on function public.kiosk_confirm_exit(text) to authenticated;

notify pgrst, 'reload schema';
