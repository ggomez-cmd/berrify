-- Store QuickBooks Desktop Bill TxnID on invoices after BillAdd.
-- Additive. Apply with `npm run db:apply`, not db:push.
-- Does not drop invoice tables. Does not touch public.shifts or payroll.

alter table public.invoices
  add column if not exists quickbooks_txn_id text;

alter table public.invoices
  add column if not exists quickbooks_edit_sequence text;
