import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/input";
import { Field } from "../../components/ui/label";
import { Table, THead, Td, Th } from "../../components/ui/table";
import { formatDuration, formatMoney } from "../../lib/format";
import {
  buildPayrollLines,
  countOpenPayrollIssues,
  formatWorkweekLabel,
  hoursFromSeconds,
  listPayrollWorkweeks,
  parsePeriodKey,
  periodKey,
  type PayrollLine,
} from "../../lib/payroll";
import { payrollFileStem, toPayrollCsv, toPayrollTimeActivityIif } from "../../lib/payroll-export";
import { restaurantFileSlug } from "../../lib/restaurant-route";
import { isManager } from "../../lib/schedule";
import { useEmployees } from "../employees/hooks";
import { useRestaurants } from "../invoices/hooks";
import {
  usePayrollExceptions,
  usePayrollOpenSessions,
  usePayrollTimeEntries,
  useSavePayrollExport,
} from "./hooks";

function downloadText(filename: string, contents: string, mime: string) {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function confirmOpenIssues(openExceptions: number, openSessions: number): boolean {
  if (openExceptions === 0 && openSessions === 0) return true;
  const parts: string[] = [];
  if (openExceptions > 0) {
    parts.push(`${openExceptions} open Time Clock exception${openExceptions === 1 ? "" : "s"}`);
  }
  if (openSessions > 0) {
    parts.push(`${openSessions} open session${openSessions === 1 ? "" : "s"}`);
  }
  return window.confirm(`${parts.join(" and ")} in this period. Export anyway?`);
}

export function PayrollPage() {
  const { org, role } = useAuth();
  const manager = isManager(role);
  const { data: restaurants = [], isLoading: restaurantsLoading } = useRestaurants();
  const { data: employees = [] } = useEmployees();
  const saveExport = useSavePayrollExport();
  const timeZone = org?.timezone ?? "America/Puerto_Rico";
  const workweeks = useMemo(
    () =>
      org
        ? listPayrollWorkweeks(new Date(), timeZone, org.workweek_start_dow, org.workweek_start_time)
        : [],
    [org, timeZone],
  );
  const [restaurantId, setRestaurantId] = useState("");
  const [periodValue, setPeriodValue] = useState("");

  const selectedRestaurant = restaurants.find((row) => row.id === restaurantId) ?? restaurants[0] ?? null;
  const resolvedRestaurantId = selectedRestaurant?.id ?? null;
  const selectedPeriod = useMemo(() => {
    const parsed = parsePeriodKey(periodValue);
    if (parsed) return { ...parsed, inProgress: workweeks.find((week) => periodKey(week) === periodValue)?.inProgress ?? false };
    return workweeks[0] ?? null;
  }, [periodValue, workweeks]);

  const entriesQuery = usePayrollTimeEntries(
    resolvedRestaurantId,
    selectedPeriod?.start ?? null,
    selectedPeriod?.end ?? null,
  );
  const exceptionsQuery = usePayrollExceptions();
  const sessionsQuery = usePayrollOpenSessions(resolvedRestaurantId);
  const entries = entriesQuery.data ?? [];

  const lines = useMemo(() => {
    if (!resolvedRestaurantId || !selectedPeriod) return [];
    return buildPayrollLines({
      punches: entries,
      employees,
      restaurantId: resolvedRestaurantId,
      periodStart: selectedPeriod.start,
      periodEnd: selectedPeriod.end,
    });
  }, [employees, entries, resolvedRestaurantId, selectedPeriod]);

  const issues = useMemo(() => {
    if (!resolvedRestaurantId || !selectedPeriod) return { openExceptions: 0, openSessions: 0 };
    return countOpenPayrollIssues({
      periodEntryIds: new Set(entries.map((row) => row.id)),
      periodEmployeeIds: new Set(lines.map((row) => row.employee_id)),
      periodStart: selectedPeriod.start,
      periodEnd: selectedPeriod.end,
      exceptions: exceptionsQuery.data ?? [],
      sessions: sessionsQuery.data ?? [],
      restaurantId: resolvedRestaurantId,
    });
  }, [entries, exceptionsQuery.data, lines, resolvedRestaurantId, selectedPeriod, sessionsQuery.data]);

  if (!manager) {
    return <Navigate to="/schedule" replace />;
  }

  const totals = lines.reduce(
    (acc, line) => ({
      regular: acc.regular + line.regular_seconds,
      ot: acc.ot + line.ot_seconds,
      gross: acc.gross + line.gross,
    }),
    { regular: 0, ot: 0, gross: 0 },
  );

  const exportPayroll = async (kind: "csv" | "iif") => {
    if (!selectedRestaurant || !selectedPeriod) return;
    if (!confirmOpenIssues(issues.openExceptions, issues.openSessions)) return;
    const meta = {
      restaurantName: selectedRestaurant.name,
      restaurantSlug: restaurantFileSlug(selectedRestaurant),
      periodStart: selectedPeriod.start,
      periodEnd: selectedPeriod.end,
      timeZone,
    };
    const stem = payrollFileStem(meta);
    switch (kind) {
      case "csv":
        downloadText(`${stem}.csv`, toPayrollCsv(lines, meta), "text/csv");
        break;
      case "iif":
        downloadText(`${stem}.iif`, toPayrollTimeActivityIif(lines, meta), "text/plain");
        break;
      default: {
        const exhaustive: never = kind;
        return exhaustive;
      }
    }
    try {
      await saveExport.mutateAsync({
        restaurantId: selectedRestaurant.id,
        periodStart: selectedPeriod.start,
        periodEnd: selectedPeriod.end,
        lines,
      });
    } catch {
      // File already downloaded; snapshot error is shown via saveExport.error.
    }
  };

  return (
    <div>
      <p className="mb-4 max-w-3xl text-sm text-muted">
        Hours from Time Clock punches × roster rate for one restaurant workweek. Export a CSV (or
        QuickBooks Desktop TIMEACTIVITY IIF) and run paychecks in QuickBooks or ADP. This is not a tax
        engine.
      </p>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Restaurant / books" htmlFor="payroll-restaurant">
          <Select
            id="payroll-restaurant"
            value={resolvedRestaurantId ?? ""}
            onChange={(e) => setRestaurantId(e.target.value)}
          >
            {restaurants.length === 0 ? <option value="">No restaurants</option> : null}
            {restaurants.map((restaurant) => (
              <option key={restaurant.id} value={restaurant.id}>
                {restaurant.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Pay period" htmlFor="payroll-period">
          <Select
            id="payroll-period"
            value={selectedPeriod ? periodKey(selectedPeriod) : ""}
            onChange={(e) => setPeriodValue(e.target.value)}
          >
            {workweeks.map((week) => (
              <option key={periodKey(week)} value={periodKey(week)}>
                {formatWorkweekLabel(week, timeZone)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-end gap-2 sm:col-span-2">
          <Button
            disabled={!selectedRestaurant || !selectedPeriod || saveExport.isPending}
            onClick={() => void exportPayroll("csv")}
          >
            Download CSV
          </Button>
          <Button
            variant="outline"
            disabled={!selectedRestaurant || !selectedPeriod || saveExport.isPending}
            onClick={() => void exportPayroll("iif")}
          >
            TIMEACTIVITY IIF
          </Button>
        </div>
      </div>

      {issues.openExceptions > 0 || issues.openSessions > 0 ? (
        <p className="mb-4 text-sm text-warn">
          {issues.openExceptions > 0
            ? `${issues.openExceptions} open Time Clock exception${issues.openExceptions === 1 ? "" : "s"}`
            : null}
          {issues.openExceptions > 0 && issues.openSessions > 0 ? " · " : null}
          {issues.openSessions > 0
            ? `${issues.openSessions} open session${issues.openSessions === 1 ? "" : "s"}`
            : null}
          . Export still works after you confirm.{" "}
          <Link className="font-medium text-wine underline" to="/time-clock">
            Review Time Clock
          </Link>
        </p>
      ) : null}

      {saveExport.error ? <p className="mb-3 text-sm text-danger">{saveExport.error.message}</p> : null}
      {entriesQuery.error ? <p className="mb-3 text-sm text-danger">{entriesQuery.error.message}</p> : null}
      {restaurantsLoading || entriesQuery.isLoading ? (
        <p className="text-sm text-muted">Loading hours…</p>
      ) : null}

      <Table>
        <THead>
          <tr>
            <Th>Employee</Th>
            <Th>Regular</Th>
            <Th>OT</Th>
            <Th>Rate</Th>
            <Th>Gross</Th>
          </tr>
        </THead>
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <Td colSpan={5} className="py-10 text-center text-muted">
                No punches in this restaurant and workweek.
              </Td>
            </tr>
          ) : (
            lines.map((line) => <PayrollRow key={line.employee_id} line={line} />)
          )}
        </tbody>
      </Table>

      {lines.length > 0 ? (
        <p className="mt-3 text-sm text-muted">
          Totals · {formatDuration(totals.regular)} regular · {formatDuration(totals.ot)} OT ·{" "}
          {formatMoney(totals.gross)} gross
        </p>
      ) : null}
    </div>
  );
}

function PayrollRow({ line }: { line: PayrollLine }) {
  return (
    <tr>
      <Td>
        <span className="font-medium">{line.full_name}</span>
        {line.hourly_rate === 0 ? (
          <Badge className="ml-2" tone="warn">
            No rate
          </Badge>
        ) : null}
      </Td>
      <Td>
        {formatDuration(line.regular_seconds)} ({hoursFromSeconds(line.regular_seconds)} h)
      </Td>
      <Td>
        {formatDuration(line.ot_seconds)} ({hoursFromSeconds(line.ot_seconds)} h)
      </Td>
      <Td>{formatMoney(line.hourly_rate)}</Td>
      <Td>{formatMoney(line.gross)}</Td>
    </tr>
  );
}
