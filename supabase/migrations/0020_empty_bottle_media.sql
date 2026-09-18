-- Multi-bottle empty capture: photo, source, counts, lines, confirm/cancel RPCs.
-- Additive. Apply with `npm run db:apply`, not db:push.

alter table public.empty_bottle_events
  add column if not exists image_data text,
  add column if not exists image_mime text,
  add column if not exists source text not null default 'telegram',
  add column if not exists vision_count integer,
  add column if not exists gemini_count integer;

alter table public.empty_bottle_events
  drop constraint if exists empty_bottle_events_source_check;
alter table public.empty_bottle_events
  add constraint empty_bottle_events_source_check
  check (source in ('telegram', 'app'));

alter table public.empty_bottle_events
  alter column telegram_message_id drop not null,
  alter column chat_id drop not null,
  alter column proposed_item_id drop not null;

drop index if exists public.empty_bottle_events_org_telegram_message_uidx;
create unique index if not exists empty_bottle_events_org_telegram_message_uidx
  on public.empty_bottle_events (org_id, telegram_message_id)
  where telegram_message_id is not null;

create table if not exists public.empty_bottle_lines (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.empty_bottle_events (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  proposed_item_id uuid references public.inventory_items (id) on delete restrict,
  proposed_label text not null,
  qty numeric not null check (qty >= 1),
  sort integer not null default 0
);

create index if not exists empty_bottle_lines_event_id_idx
  on public.empty_bottle_lines (event_id, sort);

create index if not exists empty_bottle_lines_org_id_idx
  on public.empty_bottle_lines (org_id);

alter table public.empty_bottle_lines enable row level security;

drop policy if exists empty_bottle_events_select_manager on public.empty_bottle_events;
create policy empty_bottle_events_select_manager on public.empty_bottle_events
  for select using (public.has_org_role(org_id, array['admin', 'manager']));

drop policy if exists empty_bottle_events_update_manager on public.empty_bottle_events;
create policy empty_bottle_events_update_manager on public.empty_bottle_events
  for update using (public.has_org_role(org_id, array['admin', 'manager']))
  with check (public.has_org_role(org_id, array['admin', 'manager']));

drop policy if exists empty_bottle_lines_select_manager on public.empty_bottle_lines;
create policy empty_bottle_lines_select_manager on public.empty_bottle_lines
  for select using (public.has_org_role(org_id, array['admin', 'manager']));

drop policy if exists empty_bottle_lines_insert_pending on public.empty_bottle_lines;
create policy empty_bottle_lines_insert_pending on public.empty_bottle_lines
  for insert with check (
    public.has_org_role(org_id, array['admin', 'manager'])
    and exists (
      select 1
      from public.empty_bottle_events e
      where e.id = event_id
        and e.org_id = org_id
        and e.status = 'pending'
    )
  );

drop policy if exists empty_bottle_lines_update_pending on public.empty_bottle_lines;
create policy empty_bottle_lines_update_pending on public.empty_bottle_lines
  for update using (
    public.has_org_role(org_id, array['admin', 'manager'])
    and exists (
      select 1
      from public.empty_bottle_events e
      where e.id = event_id
        and e.org_id = org_id
        and e.status = 'pending'
    )
  )
  with check (
    public.has_org_role(org_id, array['admin', 'manager'])
    and exists (
      select 1
      from public.empty_bottle_events e
      where e.id = event_id
        and e.org_id = org_id
        and e.status = 'pending'
    )
  );

drop policy if exists empty_bottle_lines_delete_pending on public.empty_bottle_lines;
create policy empty_bottle_lines_delete_pending on public.empty_bottle_lines
  for delete using (
    public.has_org_role(org_id, array['admin', 'manager'])
    and exists (
      select 1
      from public.empty_bottle_events e
      where e.id = event_id
        and e.org_id = org_id
        and e.status = 'pending'
    )
  );

grant select, update on public.empty_bottle_events to authenticated;
grant select, insert, update, delete on public.empty_bottle_lines to authenticated;

create or replace function public.protect_empty_bottle_event_status()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and old.status is distinct from new.status
     and current_setting('empty_bottle.rpc', true) is distinct from '1' then
    raise exception 'Use confirm_empty_bottle or cancel_empty_bottle';
  end if;
  return new;
end;
$$;

drop trigger if exists empty_bottle_events_protect_status on public.empty_bottle_events;
create trigger empty_bottle_events_protect_status
  before update on public.empty_bottle_events
  for each row execute function public.protect_empty_bottle_event_status();

create or replace function public.empty_bottle_debit_lines(p_event public.empty_bottle_events)
returns table (
  proposed_item_id uuid,
  proposed_label text,
  qty numeric
)
language sql
stable
set search_path = public
as $$
  with lines as (
    select
      l.proposed_item_id,
      l.proposed_label,
      l.qty
    from public.empty_bottle_lines l
    where l.event_id = p_event.id
      and l.org_id = p_event.org_id
      and l.proposed_item_id is not null
      and l.qty >= 1
    order by l.sort, l.id
  )
  select * from lines
  union all
  select
    p_event.proposed_item_id,
    p_event.proposed_label,
    1::numeric
  where not exists (select 1 from lines)
    and p_event.proposed_item_id is not null;
$$;

create or replace function public.confirm_empty_bottle(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ev public.empty_bottle_events%rowtype;
  claimed public.empty_bottle_events%rowtype;
  line record;
  place text;
  debited integer := 0;
begin
  select * into ev
  from public.empty_bottle_events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'Empty bottle event not found';
  end if;

  if auth.uid() is not null and not public.has_org_role(ev.org_id, array['admin', 'manager']) then
    raise exception 'Not authorized';
  end if;

  if ev.status is distinct from 'pending' then
    return jsonb_build_object('ok', true, 'already_handled', true, 'status', ev.status, 'debited', 0);
  end if;

  perform set_config('empty_bottle.rpc', '1', true);

  update public.empty_bottle_events
  set status = 'confirmed'
  where id = ev.id
    and status = 'pending'
  returning * into claimed;

  if not found then
    return jsonb_build_object('ok', true, 'already_handled', true, 'status', 'confirmed', 'debited', 0);
  end if;

  if claimed.restaurant_id is not null then
    select name into place
    from public.restaurants
    where id = claimed.restaurant_id;
  end if;

  for line in
    select * from public.empty_bottle_debit_lines(claimed)
  loop
    insert into public.stock_movements (org_id, item_id, delta, reason, note, created_by)
    values (
      claimed.org_id,
      line.proposed_item_id,
      -abs(line.qty),
      'usage',
      'Telegram empty bottle · ' || line.proposed_label || ' · ' || coalesce(place, 'org'),
      auth.uid()
    );
    debited := debited + 1;
  end loop;

  return jsonb_build_object('ok', true, 'already_handled', false, 'status', 'confirmed', 'debited', debited);
end;
$$;

create or replace function public.cancel_empty_bottle(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ev public.empty_bottle_events%rowtype;
begin
  select * into ev
  from public.empty_bottle_events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'Empty bottle event not found';
  end if;

  if auth.uid() is not null and not public.has_org_role(ev.org_id, array['admin', 'manager']) then
    raise exception 'Not authorized';
  end if;

  if ev.status is distinct from 'pending' then
    return jsonb_build_object('ok', true, 'already_handled', true, 'status', ev.status);
  end if;

  perform set_config('empty_bottle.rpc', '1', true);

  update public.empty_bottle_events
  set status = 'cancelled'
  where id = ev.id
    and status = 'pending';

  if not found then
    return jsonb_build_object('ok', true, 'already_handled', true, 'status', 'cancelled');
  end if;

  return jsonb_build_object('ok', true, 'already_handled', false, 'status', 'cancelled');
end;
$$;

revoke all on function public.confirm_empty_bottle(uuid) from public;
revoke all on function public.cancel_empty_bottle(uuid) from public;
grant execute on function public.confirm_empty_bottle(uuid) to authenticated;
grant execute on function public.confirm_empty_bottle(uuid) to service_role;
grant execute on function public.cancel_empty_bottle(uuid) to authenticated;
grant execute on function public.cancel_empty_bottle(uuid) to service_role;
