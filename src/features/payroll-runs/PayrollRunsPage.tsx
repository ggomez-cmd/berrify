import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Table, THead, Td, Th } from "../../components/ui/table";
import { isAdmin } from "../../lib/schedule";
import type { PayrollRunStatus } from "../../lib/types";
import { formatCents } from "./format";
import { usePayrollRuns } from "./hooks";

function statusTone(status: PayrollRunStatus): "neutral" | "ok" | "warn" {
  switch (status) {
    case "draft":
      return "warn";
    case "approved":
      return "ok";
    case "void":
      return "neutral";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export function PayrollRunsPage() {
  const { role } = useAuth();
  const navigate = useNavigate();
  const runs = usePayrollRuns();

  if (!isAdmin(role)) {
    return (
      <p className="text-sm text-muted">
        Payroll runs are limited to admins. Drafts, approvals, and pay stubs stay hidden from managers and
        staff.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted">
          Draft, review, and lock Puerto Rico payroll runs. An approved run cannot be edited.
        </p>
        <Button onClick={() => navigate("/payroll/runs/new")}>New run</Button>
      </div>
      {runs.error ? <p className="mb-3 text-sm text-danger">{runs.error.message}</p> : null}
      {runs.isLoading ? <p className="text-sm text-muted">Loading runs…</p> : null}
      <Table>
        <THead>
          <tr>
            <Th>Status</Th>
            <Th>Period</Th>
            <Th>Check date</Th>
            <Th>Gross</Th>
            <Th>Net</Th>
          </tr>
        </THead>
        <tbody>
          {(runs.data ?? []).length === 0 ? (
            <tr>
              <Td colSpan={5} className="py-10 text-center text-muted">
                No payroll runs yet.
              </Td>
            </tr>
          ) : (
            (runs.data ?? []).map((run) => (
              <tr key={run.id}>
                <Td>
                  <Link className="font-medium text-wine" to={`/payroll/runs/${run.id}`}>
                    <Badge tone={statusTone(run.status)}>{run.status}</Badge>
                  </Link>
                </Td>
                <Td>
                  {run.period_start.slice(0, 10)} – {run.period_end.slice(0, 10)}
                </Td>
                <Td>{run.check_date.slice(0, 10)}</Td>
                <Td>{formatCents(run.gross_cents)}</Td>
                <Td>{formatCents(run.net_cents)}</Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
    </div>
  );
}
