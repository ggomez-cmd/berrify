import { useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { Table, THead, Td, Th } from "../../components/ui/table";
import {
  centsToDollarInput,
  OPENING_BALANCES_CSV_HEADER,
  parseOpeningBalancesCsv,
  type OpeningBalanceImportRow,
} from "../../lib/payroll/setup";
import { useEmployees } from "../employees/hooks";
import {
  useDeletePayrollOpeningBalance,
  useImportPayrollOpeningBalances,
  usePayrollEmployeeProfiles,
  usePayrollOpeningBalances,
} from "./hooks";

export function OpeningBalancesPanel() {
  const { data: employees = [] } = useEmployees();
  const { data: profiles = [] } = usePayrollEmployeeProfiles();
  const { data: balances = [], isLoading, error } = usePayrollOpeningBalances();
  const importer = useImportPayrollOpeningBalances();
  const remove = useDeletePayrollOpeningBalance();
  const [csvText, setCsvText] = useState("");
  const [preview, setPreview] = useState<ReturnType<typeof parseOpeningBalancesCsv> | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const nameById = useMemo(
    () => new Map(employees.map((employee) => [employee.id, employee.full_name])),
    [employees],
  );
  const numberLookup = useMemo(() => {
    const lookup: Record<string, string> = {};
    for (const profile of profiles) {
      if (profile.employee_number) lookup[profile.employee_number] = profile.employee_id;
    }
    return lookup;
  }, [profiles]);

  const parseFile = (text: string) => {
    setCsvText(text);
    setFormError(null);
    setPreview(parseOpeningBalancesCsv(text, numberLookup));
  };

  const importRows = async (rows: OpeningBalanceImportRow[]) => {
    setFormError(null);
    try {
      await importer.mutateAsync(rows);
      setPreview(null);
      setCsvText("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not import opening balances");
    }
  };

  const groupedYears = useMemo(() => {
    const years = [...new Set(balances.map((row) => row.tax_year))].sort((a, b) => b - a);
    return years.map((year) => ({
      year,
      rows: balances.filter((row) => row.tax_year === year),
    }));
  }, [balances]);

  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        Import predecessor-company year-to-date. Amounts are dollars such as 1,234.56. Import is blocked
        while any row has an error. Sample header:
      </p>
      <pre className="mb-3 overflow-x-auto rounded-xl border border-line bg-paper p-3 text-xs text-ink">
        {OPENING_BALANCES_CSV_HEADER}
      </pre>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept=".csv,text/csv"
          className="text-sm text-muted file:mr-3 file:rounded-xl file:border-0 file:bg-wine file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            void file.text().then(parseFile);
          }}
        />
        {csvText ? (
          <Button variant="ghost" onClick={() => parseFile(csvText)}>
            Re-check
          </Button>
        ) : null}
      </div>

      {preview ? (
        <div className="mb-6">
          {preview.errors.length > 0 ? (
            <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-danger">
              {preview.errors.map((item) => (
                <li key={`${item.line}-${item.message}`}>
                  Line {item.line}: {item.message}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-sm text-muted">{preview.rows.length} row{preview.rows.length === 1 ? "" : "s"} ready to upsert.</p>
          )}
          <Table>
            <THead>
              <tr>
                <Th>Number</Th>
                <Th>Year</Th>
                <Th>Source</Th>
                <Th>Gross</Th>
                <Th>Taxes</Th>
              </tr>
            </THead>
            <tbody>
              {preview.rows.length === 0 ? (
                <tr>
                  <Td colSpan={5} className="py-8 text-center text-muted">
                    No valid rows to preview.
                  </Td>
                </tr>
              ) : (
                preview.rows.map((row) => (
                  <tr key={`${row.employeeNumber}-${row.taxYear}-${row.source}`}>
                    <Td>{row.employeeNumber}</Td>
                    <Td>{row.taxYear}</Td>
                    <Td>{row.source}</Td>
                    <Td>{centsToDollarInput(row.grossCents)}</Td>
                    <Td>{row.taxes.length}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
          <div className="mt-3">
            <Button
              disabled={preview.errors.length > 0 || preview.rows.length === 0 || importer.isPending}
              onClick={() => void importRows(preview.rows)}
            >
              {importer.isPending ? "Importing…" : "Import balances"}
            </Button>
          </div>
        </div>
      ) : null}

      {formError ? <p className="mb-3 text-sm text-danger">{formError}</p> : null}
      {error ? <p className="mb-3 text-sm text-danger">{error.message}</p> : null}
      {isLoading ? <p className="text-sm text-muted">Loading opening balances…</p> : null}

      {groupedYears.map((group) => (
        <div key={group.year} className="mb-6">
          <h3 className="mb-2 text-base font-semibold tracking-tight">{group.year}</h3>
          <Table>
            <THead>
              <tr>
                <Th>Employee</Th>
                <Th>Source</Th>
                <Th>Gross</Th>
                <Th>Tax lines</Th>
                <Th />
              </tr>
            </THead>
            <tbody>
              {group.rows.map((row) => (
                <tr key={row.id}>
                  <Td>{nameById.get(row.employee_id) ?? row.employee_id}</Td>
                  <Td>{row.source}</Td>
                  <Td>{centsToDollarInput(row.gross_cents)}</Td>
                  <Td>{row.payroll_opening_balance_taxes.length}</Td>
                  <Td>
                    <div className="flex justify-end">
                      <Button
                        variant="subtle"
                        onClick={() => {
                          if (window.confirm("Delete this opening balance?")) {
                            void remove.mutateAsync(row.id);
                          }
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      ))}

      {!isLoading && balances.length === 0 ? (
        <p className="text-sm text-muted">No opening balances stored yet.</p>
      ) : null}
    </div>
  );
}
