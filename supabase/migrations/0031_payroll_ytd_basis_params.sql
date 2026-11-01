-- Fix 0030: parameter names tax_year / before_check_date / target_org_id
-- collided with column names. In load_payroll_ytd_basis (plpgsql) that raised
-- "column reference tax_year is ambiguous"; in payroll_ytd_basis_revision (sql)
-- the column won silently, so b.tax_year = tax_year matched every year.
-- Qualify each parameter with its function name; signatures are unchanged.

create or replace function public.payroll_ytd_basis_revision(
  target_org_id uuid,
  tax_year integer,
  before_check_date date
)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select md5(
    coalesce(
      (
        select string_agg(
          r.id::text
            || E'\t' || r.status
            || E'\t' || coalesce(to_char(r.approved_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '')
            || E'\t' || coalesce(to_char(r.voided_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), ''),
          E'\n'
          order by r.check_date, r.id
        )
        from public.payroll_runs r
        where r.org_id = payroll_ytd_basis_revision.target_org_id
          and extract(year from r.check_date)::integer = payroll_ytd_basis_revision.tax_year
          and r.check_date < payroll_ytd_basis_revision.before_check_date
          and r.status is distinct from 'draft'
      ),
      ''
    )
    || E'\n--balances--\n'
    || coalesce(
      (
        select string_agg(
          b.id::text
            || E'\t' || b.gross_cents::text
            || E'\t' || coalesce(to_char(b.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), ''),
          E'\n'
          order by b.id
        )
        from public.payroll_opening_balances b
        where b.org_id = payroll_ytd_basis_revision.target_org_id
          and b.tax_year = payroll_ytd_basis_revision.tax_year
      ),
      ''
    )
    || E'\n--taxes--\n'
    || coalesce(
      (
        select string_agg(
          t.id::text
            || E'\t' || t.taxable_cents::text
            || E'\t' || t.withheld_cents::text
            || E'\t' || t.employer_cents::text
            || E'\t' || coalesce(to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), ''),
          E'\n'
          order by t.id
        )
        from public.payroll_opening_balance_taxes t
        join public.payroll_opening_balances b
          on b.id = t.opening_balance_id
         and b.org_id = t.org_id
        where b.org_id = payroll_ytd_basis_revision.target_org_id
          and b.tax_year = payroll_ytd_basis_revision.tax_year
      ),
      ''
    )
  );
$$;

revoke all on function public.payroll_ytd_basis_revision(uuid, integer, date) from public, anon;
grant execute on function public.payroll_ytd_basis_revision(uuid, integer, date) to authenticated;

-- One snapshot of the YTD history the editor needs. Callers must use this RPC
-- instead of separate table queries so calculate/save share the same revision.
create or replace function public.load_payroll_ytd_basis(
  target_org_id uuid,
  tax_year integer,
  before_check_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  snapshot jsonb;
begin
  if not public.has_org_role(load_payroll_ytd_basis.target_org_id, array['admin']) then
    raise exception 'not authorized';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(load_payroll_ytd_basis.target_org_id::text || ':' || load_payroll_ytd_basis.tax_year::text, 0)
  );

  select jsonb_build_object(
    'revision', public.payroll_ytd_basis_revision(load_payroll_ytd_basis.target_org_id, load_payroll_ytd_basis.tax_year, load_payroll_ytd_basis.before_check_date),
    'opening_balances', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', b.id,
          'employee_id', b.employee_id,
          'tax_year', b.tax_year,
          'gross_cents', b.gross_cents,
          'taxes', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', t.id,
                'tax_code', t.tax_code,
                'taxable_cents', t.taxable_cents,
                'withheld_cents', t.withheld_cents,
                'employer_cents', t.employer_cents
              )
              order by t.tax_code, t.id
            )
            from public.payroll_opening_balance_taxes t
            where t.opening_balance_id = b.id
              and t.org_id = b.org_id
          ), '[]'::jsonb)
        )
        order by b.employee_id, b.id
      )
      from public.payroll_opening_balances b
      where b.org_id = load_payroll_ytd_basis.target_org_id
        and b.tax_year = load_payroll_ytd_basis.tax_year
    ), '[]'::jsonb),
    'prior_check_taxes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'employee_id', c.employee_id,
          'tax_year', load_payroll_ytd_basis.tax_year,
          'check_date', r.check_date,
          'status', r.status,
          'side', t.side,
          'tax_code', t.tax_code,
          'taxable_cents', t.taxable_cents,
          'amount_cents', t.amount_cents
        )
        order by r.check_date, c.employee_id, t.side, t.tax_code, t.id
      )
      from public.payroll_runs r
      join public.payroll_checks c
        on c.run_id = r.id
       and c.org_id = r.org_id
      join public.payroll_check_taxes t
        on t.check_id = c.id
       and t.org_id = c.org_id
      where r.org_id = load_payroll_ytd_basis.target_org_id
        and extract(year from r.check_date)::integer = load_payroll_ytd_basis.tax_year
        and r.check_date < load_payroll_ytd_basis.before_check_date
        and r.status = 'approved'
    ), '[]'::jsonb),
    'prior_gross', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'employee_id', c.employee_id,
          'tax_year', load_payroll_ytd_basis.tax_year,
          'check_date', r.check_date,
          'status', r.status,
          'gross_cents', c.gross_cents
        )
        order by r.check_date, c.employee_id, c.id
      )
      from public.payroll_runs r
      join public.payroll_checks c
        on c.run_id = r.id
       and c.org_id = r.org_id
      where r.org_id = load_payroll_ytd_basis.target_org_id
        and extract(year from r.check_date)::integer = load_payroll_ytd_basis.tax_year
        and r.check_date < load_payroll_ytd_basis.before_check_date
        and r.status = 'approved'
    ), '[]'::jsonb)
  )
  into snapshot;

  return snapshot;
end;
$$;

revoke all on function public.load_payroll_ytd_basis(uuid, integer, date) from public, anon;
grant execute on function public.load_payroll_ytd_basis(uuid, integer, date) to authenticated;
