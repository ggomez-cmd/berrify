import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Textarea } from "../../components/ui/input";
import { Field } from "../../components/ui/label";
import { costPerBusinessCsv, registerCsv } from "../../lib/payroll/reports";
import { resultFromStoredRun } from "../../lib/payroll/runs";
import { isAdmin } from "../../lib/schedule";
import { useEmployees } from "../employees/hooks";
import { useRestaurants } from "../invoices/hooks";
import { usePayrollEmployeeProfiles } from "../payroll-setup/hooks";
import { CheckDetail, ChecksTable, IssuesPanel, RunSummaryPanel } from "./RunPanels";
import { usePayrollRun, useVoidPayrollRun } from "./hooks";

function downloadText(filename: string, contents: string) {
  const blob = new Blob([contents], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function PayrollRunDetailPage({ runId }: { runId: string }) {
  const { role } = useAuth();
  const runQuery = usePayrollRun(runId);
  const employeesQuery = useEmployees();
  const restaurantsQuery = useRestaurants();
  const profilesQuery = usePayrollEmployeeProfiles();
  const voidRun = useVoidPayrollRun();
  const [voidOpen, setVoidOpen] = useState(false);
  const [reason, setReason] = useState("");

  const names = useMemo(() => {
    const map: Record<string, string> = {};
    for (const row of employeesQuery.data ?? []) map[row.id] = row.full_name;
    return map;
  }, [employeesQuery.data]);
  const numbers = useMemo(() => {
    const map: Record<string, string> = {};
    for (const row of profilesQuery.data ?? []) {
      if (row.employee_number) map[row.employee_id] = row.employee_number;
    }
    return map;
  }, [profilesQuery.data]);
  const restaurantNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const row of restaurantsQuery.data ?? []) map[row.id] = row.name;
    return map;
  }, [restaurantsQuery.data]);

  if (!isAdmin(role)) {
    return (
      <p className="text-sm text-muted">
        Payroll runs are limited to admins. Drafts, approvals, and pay stubs stay hidden from managers and
        staff.
      </p>
    );
  }
  if (runQuery.isLoading) return <p className="text-sm text-muted">Loading run…</p>;
  if (runQuery.error) return <p className="text-sm text-danger">{runQuery.error.message}</p>;
  if (!runQuery.data) return <p className="text-sm text-muted">Run not found.</p>;

  const run = runQuery.data;
  const result = resultFromStoredRun(run);
  const canExport = run.status === "approved" && result.errors.length === 0;
  const tone = run.status === "approved" ? "ok" : run.status === "draft" ? "warn" : "neutral";

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Badge tone={tone}>{run.status}</Badge>
          <p className="mt-2 text-sm text-muted">
            {run.period_start.slice(0, 10)} – {run.period_end.slice(0, 10)} · check {run.check_date.slice(0, 10)} ·{" "}
            {run.hours_source === "time_clock" ? "Time Clock" : "Clover"}
          </p>
          {run.void_reason ? <p className="mt-1 text-sm text-ink">Void reason: {run.void_reason}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {run.status === "draft" ? (
            <Link className="inline-flex items-center text-sm font-medium text-wine" to={`/payroll/runs/${run.id}/edit`}>
              Edit draft
            </Link>
          ) : null}
          {canExport ? (
            <Link className="inline-flex items-center text-sm font-medium text-wine" to={`/payroll/runs/${run.id}/stubs`}>
              Print stubs
            </Link>
          ) : null}
          <Button
            variant="outline"
            disabled={!canExport}
            onClick={() => downloadText(`payroll-register-${run.check_date.slice(0, 10)}.csv`, registerCsv(result, names))}
          >
            Register CSV
          </Button>
          <Button
            variant="ghost"
            disabled={!canExport}
            onClick={() =>
              downloadText(`payroll-cost-${run.check_date.slice(0, 10)}.csv`, costPerBusinessCsv(result, restaurantNames))
            }
          >
            Cost CSV
          </Button>
          {run.status === "approved" ? (
            <Button variant="danger" onClick={() => setVoidOpen(true)}>
              Void
            </Button>
          ) : null}
        </div>
      </div>

      <IssuesPanel errors={result.errors} warnings={result.warnings} names={names} restaurantNames={restaurantNames} />
      <RunSummaryPanel result={result} restaurantNames={restaurantNames} />
      <ChecksTable checks={result.checks} names={names} numbers={numbers} />
      {result.checks.map((check) => (
        <div key={check.employeeId} className="grid gap-2">
          <CheckDetail
            check={check}
            name={names[check.employeeId] ?? check.employeeId}
            number={numbers[check.employeeId]}
          />
          {canExport ? (
            <Link className="text-sm font-medium text-wine" to={`/payroll/runs/${run.id}/stubs/${check.employeeId}`}>
              Print this stub
            </Link>
          ) : null}
        </div>
      ))}

      <Dialog
        open={voidOpen}
        onOpenChange={setVoidOpen}
        title="Void this approved run"
        description="Voiding keeps the rows but removes the run from live check-date uniqueness and YTD."
        footer={
          <>
            <Button variant="ghost" onClick={() => setVoidOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={!reason.trim() || voidRun.isPending}
              onClick={() => {
                void voidRun.mutateAsync({ runId: run.id, reason }).then(() => {
                  setVoidOpen(false);
                  setReason("");
                });
              }}
            >
              Void run
            </Button>
          </>
        }
      >
        <Field label="Reason" htmlFor="void-reason">
          <Textarea id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {voidRun.error ? <p className="mt-2 text-sm text-danger">{voidRun.error.message}</p> : null}
      </Dialog>
    </div>
  );
}
