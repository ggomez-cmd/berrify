-- Telegram Bot invoice photo ingest. Additive. Do not db:push.

alter table public.invoices add column if not exists telegram_from text;
alter table public.invoices add column if not exists telegram_message_id text;

do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.invoices'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%source in%';
  if cname is not null then
    execute format('alter table public.invoices drop constraint %I', cname);
  end if;
end
$$;

alter table public.invoices
  add constraint invoices_source_check
  check (source in ('upload', 'whatsapp', 'camera', 'telegram'));

create unique index if not exists invoices_org_telegram_message_uidx
  on public.invoices (org_id, telegram_message_id)
  where telegram_message_id is not null;
