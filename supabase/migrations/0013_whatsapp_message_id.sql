-- Dedup Cloud API invoice ingest. Additive. Do not db:push.

create unique index if not exists invoices_org_whatsapp_message_uidx
  on public.invoices (org_id, whatsapp_message_id)
  where whatsapp_message_id is not null;
