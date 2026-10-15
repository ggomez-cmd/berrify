-- How a reviewed invoice reaches QuickBooks: an unpaid Bill, a credit card
-- charge, or a check / bank payment for receipts that were already paid.
-- Additive. Apply with `npm run db:apply`, not db:push.
-- Does not drop invoice tables. Does not touch public.shifts or payroll.
-- A card or check without payment_account is a draft; Send rejects it.

alter table public.invoices
  add column if not exists payment_kind text not null default 'bill';

alter table public.invoices
  add column if not exists payment_account text;

alter table public.invoices
  add column if not exists payment_ref text;

alter table public.invoices
  drop constraint if exists invoices_payment_kind_check;

alter table public.invoices
  add constraint invoices_payment_kind_check
  check (payment_kind in ('bill', 'credit_card', 'check'));
