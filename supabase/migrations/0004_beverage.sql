alter table public.invoice_lines drop constraint if exists invoice_lines_category_check;
alter table public.invoice_lines
  add constraint invoice_lines_category_check
  check (category in ('food', 'kitchen', 'cleaning', 'tax', 'other', 'beverage'));

alter table public.account_rules drop constraint if exists account_rules_category_check;
alter table public.account_rules
  add constraint account_rules_category_check
  check (category in ('food', 'kitchen', 'cleaning', 'tax', 'other', 'beverage'));
