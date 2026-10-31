import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Dialog } from "../../components/ui/dialog";
import { Input, Select } from "../../components/ui/input";
import { Field } from "../../components/ui/label";
import { Table, THead, Td, Th } from "../../components/ui/table";
import { dollarsToCents } from "../../lib/payroll/setup";
import {
  buildRunInput,
  canApprove,
  isRunInputsSnapshot,
  openingBalancesForYtd,
  payrollCalculationIsStale,
  previewPayrollRun,
  taxYearFromCheckDate,
  toDraftPayload,
  ytdFromHistory,
  type ManualAdjustmentInput,
  type PayrollCalculationSource,
  type PayrollRunInputsSnapshot,
  type PayrollRunSettingsSnapshot,
} from "../../lib/payroll/runs";
import { workweekIdsForPeriod } from "../../lib/payroll-engine/hours/time";
import type { HoursSource } from "../../lib/payroll-engine/hours/types";
import type { PayrollRunResult } from "../../lib/payroll-engine/types";
import { isAdmin } from "../../lib/schedule";
import { useEmployees } from "../employees/hooks";
import { useRestaurants } from "../invoices/hooks";
import {
  usePayrollCloverNames,
  usePayrollEmployeeProfiles,
  usePayrollEmployerSettings,
  usePayrollPayRates,
} from "../payroll-setup/hooks";
import { CheckDetail, ChecksTable, IssuesPanel, RunSummaryPanel } from "./RunPanels";
import { parseSignedCents } from "./format";
import {
  useApprovePayrollRun,
  useDiscardPayrollRunDraft,
  usePayrollRun,
  usePayrollRunTimeEntries,
  usePayrollYtdBasis,
  useSavePayrollRunDraft,
} from "./hooks";

function isYtdStaleError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /stale|recalculate/i.test(message);
}

type AdjustmentDraft = {
  key: string;
  employeeId: string;
  dollars: string;
  reason: string;
  restaurantId: string;
};

function tipKey(employeeId: string, workweekId: string): string {
  return `${employeeId}\t${workweekId}`;
}

export function PayrollRunEditorPage({ runId }: { runId?: string }) {
  const { org, role } = useAuth();
  const navigate = useNavigate();
  const stored = usePayrollRun(runId);
  const settingsQuery = usePayrollEmployerSettings();
  const profilesQuery = usePayrollEmployeeProfiles();
  const ratesQuery = usePayrollPayRates();
  const cloverQuery = usePayrollCloverNames();
  const employeesQuery = useEmployees();
  const restaurantsQuery = useRestaurants();
  const saveDraft = useSavePayrollRunDraft();
  const approve = useApprovePayrollRun();
  const discardDraft = useDiscardPayrollRunDraft();

  const restored = isRunInputsSnapshot(stored.data?.inputs) ? stored.data.inputs : null;
  const [periodStart, setPeriodStart] = useState(stored.data?.period_start.slice(0, 10) ?? restored?.periodStart ?? "");
  const [periodEnd, setPeriodEnd] = useState(stored.data?.period_end.slice(0, 10) ?? restored?.periodEnd ?? "");
  const [checkDate, setCheckDate] = useState(stored.data?.check_date.slice(0, 10) ?? restored?.checkDate ?? "");
  const [hoursSource, setHoursSource] = useState<HoursSource>(
    stored.data?.hours_source ?? restored?.hoursSource ?? "time_clock",
  );
  const [cloverCsv, setCloverCsv] = useState("");
  const [tips, setTips] = useState<Record<string, string>>(() => {
    const next: Record<string, string> = {};
    for (const tip of restored?.tips ?? []) {
      next[tipKey(tip.employeeId, tip.workweekId)] = (tip.tipsCents / 100).toFixed(2);
    }
    return next;
  });
  const [adjustments, setAdjustments] = useState<AdjustmentDraft[]>(() =>
    (restored?.adjustments ?? []).map((row, index) => ({
      key: `adj-${index}`,
      employeeId: row.employeeId,
      dollars: (row.amountCents / 100).toFixed(2),
      reason: row.reason ?? "",
      restaurantId: row.classId ?? "",
    })),
  );
  const [notes, setNotes] = useState(stored.data?.notes ?? "");
  const [result, setResult] = useState<PayrollRunResult | null>(null);
  const [builtInputs, setBuiltInputs] = useState<PayrollRunInputsSnapshot | null>(null);
  const [settingsSnapshot, setSettingsSnapshot] = useState<PayrollRunSettingsSnapshot | null>(null);
  const [computedFrom, setComputedFrom] = useState<PayrollCalculationSource | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [hydratedId, setHydratedId] = useState<string | null>(null);

  const timeQuery = usePayrollRunTimeEntries(periodStart, periodEnd);
  const taxYear = checkDate ? taxYearFromCheckDate(checkDate) : null;
  const ytdBasisQuery = usePayrollYtdBasis(taxYear, checkDate);

  useEffect(() => {
    if (!runId || !stored.data || hydratedId === stored.data.id) return;
    setPeriodStart(stored.data.period_start.slice(0, 10));
    setPeriodEnd(stored.data.period_end.slice(0, 10));
    setCheckDate(stored.data.check_date.slice(0, 10));
    setHoursSource(stored.data.hours_source);
    setNotes(stored.data.notes ?? "");
    if (isRunInputsSnapshot(stored.data.inputs)) {
      const nextTips: Record<string, string> = {};
      for (const tip of stored.data.inputs.tips) {
        nextTips[tipKey(tip.employeeId, tip.workweekId)] = (tip.tipsCents / 100).toFixed(2);
      }
      setTips(nextTips);
      setAdjustments(
        stored.data.inputs.adjustments.map((row, index) => ({
          key: `adj-${index}`,
          employeeId: row.employeeId,
          dollars: (row.amountCents / 100).toFixed(2),
          reason: row.reason ?? "",
          restaurantId: row.classId ?? "",
        })),
      );
    }
    setHydratedId(stored.data.id);
  }, [hydratedId, runId, stored.data]);

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

  const workweekIds = useMemo(() => {
    if (!periodStart || !periodEnd) return [];
    const settings = settingsQuery.data ?? [];
    const latest = settings[0];
    try {
      return workweekIdsForPeriod({
        timeZone: latest?.time_zone ?? org?.timezone ?? "America/Puerto_Rico",
        workweekStartDow: latest?.workweek_start_day ?? org?.workweek_start_dow ?? 0,
        workweekStartTime: org?.workweek_start_time ?? "00:00",
        periodStart,
        periodEnd,
      });
    } catch {
      return [];
    }
  }, [org, periodEnd, periodStart, settingsQuery.data]);

  const tippedProfiles = (profilesQuery.data ?? []).filter((row) => row.is_tipped);

  const calculationSource = useMemo<PayrollCalculationSource>(
    () => ({
      periodStart,
      periodEnd,
      checkDate,
      hoursSource,
      cloverCsv,
      tips,
      adjustments: adjustments.map((row) => ({
        employeeId: row.employeeId,
        dollars: row.dollars,
        reason: row.reason,
        restaurantId: row.restaurantId,
      })),
      historyFingerprint: "",
      openingBalancesFingerprint: "",
      ytdBasisRevision: ytdBasisQuery.data?.revision ?? "",
    }),
    [
      adjustments,
      checkDate,
      cloverCsv,
      hoursSource,
      periodEnd,
      periodStart,
      tips,
      ytdBasisQuery.data?.revision,
    ],
  );

  useEffect(() => {
    if (!payrollCalculationIsStale(computedFrom, calculationSource)) return;
    setResult(null);
    setBuiltInputs(null);
    setSettingsSnapshot(null);
    setComputedFrom(null);
  }, [calculationSource, computedFrom]);

  const sharedPrerequisites = [
    settingsQuery,
    profilesQuery,
    ratesQuery,
    restaurantsQuery,
    employeesQuery,
    ...(checkDate ? [ytdBasisQuery] : []),
  ];
  const hoursPrerequisites = (() => {
    switch (hoursSource) {
      case "time_clock":
        return [timeQuery];
      case "clover":
        return [cloverQuery];
      default: {
        const exhaustive: never = hoursSource;
        throw new Error(`Unhandled hours source: ${exhaustive}`);
      }
    }
  })();
  const prerequisiteQueries = [...sharedPrerequisites, ...hoursPrerequisites];
  const prerequisitesReady =
    prerequisiteQueries.every((query) => query.isSuccess) &&
    (hoursSource !== "clover" || cloverCsv.trim().length > 0);
  const prerequisiteErrors = prerequisiteQueries.flatMap((query) =>
    query.error ? [query.error.message] : [],
  );

  if (!isAdmin(role)) {
    return (
      <p className="text-sm text-muted">
        Payroll runs are limited to admins. Drafts, approvals, and pay stubs stay hidden from managers and
        staff.
      </p>
    );
  }

  if (runId && stored.isLoading) {
    return <p className="text-sm text-muted">Loading draft…</p>;
  }
  if (runId && stored.error) {
    return <p className="text-sm text-danger">{stored.error.message}</p>;
  }
  if (runId && stored.data && stored.data.status !== "draft") {
    return (
      <p className="text-sm text-muted">
        This run is {stored.data.status}.{" "}
        <Link className="font-medium text-wine" to={`/payroll/runs/${runId}`}>
          Open the locked detail
        </Link>
        .
      </p>
    );
  }

  const onCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setCloverCsv(await file.text());
  };

  const calculate = () => {
    setFormError(null);
    if (!prerequisitesReady) {
      setFormError("Wait for payroll setup, history, and hours to finish loading");
      return;
    }
    if (!periodStart || !periodEnd || !checkDate) {
      setFormError("Period start, period end, and check date are required");
      return;
    }
    if (!settingsQuery.data || !profilesQuery.data || !ratesQuery.data || !ytdBasisQuery.data) {
      setFormError("Payroll setup and year-to-date history must finish loading before calculate");
      return;
    }
    const clockHours = hoursSource === "time_clock" ? timeQuery.data : undefined;
    const cloverNames = hoursSource === "clover" ? cloverQuery.data : undefined;
    if (hoursSource === "time_clock" && !clockHours) {
      setFormError("Time Clock punches must finish loading before calculate");
      return;
    }
    if (hoursSource === "clover" && !cloverNames) {
      setFormError("Clover name mappings must finish loading before calculate");
      return;
    }
    const tipLines = Object.entries(tips).flatMap(([key, raw]) => {
      const [employeeId, workweekId] = key.split("\t");
      if (!employeeId || !workweekId) return [];
      const cents = dollarsToCents(raw);
      if (cents === null || cents === 0) return [];
      return [{ employeeId, workweekId, tipsCents: cents }];
    });
    const adjustmentLines: ManualAdjustmentInput[] = [];
    for (const row of adjustments) {
      if (!row.employeeId || !row.dollars.trim()) continue;
      const cents = parseSignedCents(row.dollars);
      if (cents === null) {
        setFormError("Adjustment amounts must look like 12.50");
        return;
      }
      if (cents === 0) continue;
      adjustmentLines.push({
        employeeId: row.employeeId,
        amountCents: cents,
        reason: row.reason.trim() || null,
        classId: row.restaurantId || null,
      });
    }
    const year = taxYearFromCheckDate(checkDate);
    const ytd = ytdFromHistory(
      openingBalancesForYtd(ytdBasisQuery.data.opening_balances),
      ytdBasisQuery.data.prior_check_taxes,
      ytdBasisQuery.data.prior_gross,
      year,
    );
    const built = buildRunInput({
      checkDate,
      periodStart,
      periodEnd,
      hoursSource,
      workweekStartTime: org?.workweek_start_time ?? "00:00",
      employerSettingsRows: settingsQuery.data,
      profiles: profilesQuery.data,
      payRates: ratesQuery.data,
      cloverNames,
      timeEntries: clockHours?.timeEntries,
      timeBreaks: clockHours?.timeBreaks,
      cloverCsv: hoursSource === "clover" ? cloverCsv : undefined,
      tips: tipLines,
      adjustments: adjustmentLines,
      ytdByEmployee: ytd,
    });
    const preview = previewPayrollRun(built);
    setResult(preview);
    setSettingsSnapshot(built.settingsSnapshot);
    setComputedFrom(calculationSource);
    setBuiltInputs({
      ...built.input,
      hoursSource,
      periodStart,
      periodEnd,
      shifts: built.shifts,
      tips: built.tips,
      adjustments: built.adjustments,
    });
  };

  const persist = async (): Promise<string | null> => {
    if (!result || !builtInputs || !computedFrom) {
      setFormError("Calculate the run before saving");
      return null;
    }
    if (payrollCalculationIsStale(computedFrom, calculationSource)) {
      setFormError("Calculate again after changing the period, date, hours, tips, adjustments, history, or opening balances");
      return null;
    }
    if (!settingsSnapshot) {
      setFormError("Employer settings are required to save a draft");
      return null;
    }
    const payload = toDraftPayload(result, {
      periodStart: builtInputs.periodStart,
      periodEnd: builtInputs.periodEnd,
      hoursSource: builtInputs.hoursSource,
      settings: settingsSnapshot,
      inputs: builtInputs,
      notes,
      ytdBasisRevision: computedFrom.ytdBasisRevision,
    });
    try {
      return await saveDraft.mutateAsync({
        runId: runId ?? null,
        run: payload.run,
        checks: payload.checks,
      });
    } catch (error) {
      if (isYtdStaleError(error)) {
        setResult(null);
        setBuiltInputs(null);
        setSettingsSnapshot(null);
        setComputedFrom(null);
        setFormError("Recalculate: year-to-date changed");
        return null;
      }
      throw error;
    }
  };

  const approval = result ? canApprove(result) : { ok: false as const, reasons: ["Calculate the run first"] };

  return (
    <div className="grid gap-4">
      <p className="max-w-3xl text-sm text-muted">
        Choose a period, load hours, enter tips, then calculate. Save a draft to come back. Approve locks the
        run.
      </p>
      <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Period start" htmlFor="run-start">
          <Input id="run-start" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
        </Field>
        <Field label="Period end" htmlFor="run-end">
          <Input id="run-end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
        </Field>
        <Field label="Check date" htmlFor="run-check">
          <Input id="run-check" type="date" value={checkDate} onChange={(e) => setCheckDate(e.target.value)} />
        </Field>
        <Field label="Hours source" htmlFor="run-source">
          <Select
            id="run-source"
            value={hoursSource}
            onChange={(e) => setHoursSource(e.target.value as HoursSource)}
          >
            <option value="time_clock">Berrify Time Clock</option>
            <option value="clover">Clover CSV</option>
          </Select>
        </Field>
        {hoursSource === "clover" ? (
          <Field label="Clover CSV" htmlFor="run-clover">
            <Input id="run-clover" type="file" accept=".csv,text/csv" onChange={(e) => void onCsv(e)} />
          </Field>
        ) : (
          <p className="text-sm text-muted sm:col-span-2 lg:col-span-4">
            Time Clock rows load for the period plus the prior 7 days for rolling overtime.
            {timeQuery.isLoading ? " Loading punches…" : null}
            {timeQuery.data ? ` ${timeQuery.data.timeEntries.length} punches loaded.` : null}
          </p>
        )}
        <Field label="Notes" htmlFor="run-notes">
          <Input id="run-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </Card>

      <Card>
        <h2 className="text-base font-semibold tracking-tight">Tips by workweek</h2>
        {tippedProfiles.length === 0 || workweekIds.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Tipped employees and workweeks appear after you set a period.</p>
        ) : (
          <Table className="mt-3">
            <THead>
              <tr>
                <Th>Employee</Th>
                {workweekIds.map((week) => (
                  <Th key={week}>{week}</Th>
                ))}
              </tr>
            </THead>
            <tbody>
              {tippedProfiles.map((profile) => (
                <tr key={profile.employee_id}>
                  <Td>{names[profile.employee_id] ?? profile.employee_number ?? profile.employee_id}</Td>
                  {workweekIds.map((week) => (
                    <Td key={week}>
                      <Input
                        value={tips[tipKey(profile.employee_id, week)] ?? ""}
                        onChange={(e) =>
                          setTips((current) => ({ ...current, [tipKey(profile.employee_id, week)]: e.target.value }))
                        }
                        inputMode="decimal"
                        aria-label={`Tips ${profile.employee_id} ${week}`}
                      />
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight">Manual adjustments</h2>
          <Button
            variant="ghost"
            onClick={() =>
              setAdjustments((rows) => [
                ...rows,
                { key: `adj-${rows.length}-${Date.now()}`, employeeId: "", dollars: "", reason: "", restaurantId: "" },
              ])
            }
          >
            Add line
          </Button>
        </div>
        <div className="grid gap-3">
          {adjustments.map((row) => (
            <div key={row.key} className="grid gap-2 sm:grid-cols-4">
              <Select
                value={row.employeeId}
                onChange={(e) =>
                  setAdjustments((rows) =>
                    rows.map((item) => (item.key === row.key ? { ...item, employeeId: e.target.value } : item)),
                  )
                }
              >
                <option value="">Employee</option>
                {(profilesQuery.data ?? []).map((profile) => (
                  <option key={profile.employee_id} value={profile.employee_id}>
                    {names[profile.employee_id] ?? profile.employee_number ?? profile.employee_id}
                  </option>
                ))}
              </Select>
              <Input
                value={row.dollars}
                onChange={(e) =>
                  setAdjustments((rows) =>
                    rows.map((item) => (item.key === row.key ? { ...item, dollars: e.target.value } : item)),
                  )
                }
                placeholder="0.00"
              />
              <Input
                value={row.reason}
                onChange={(e) =>
                  setAdjustments((rows) =>
                    rows.map((item) => (item.key === row.key ? { ...item, reason: e.target.value } : item)),
                  )
                }
                placeholder="Reason"
              />
              <Select
                value={row.restaurantId}
                onChange={(e) =>
                  setAdjustments((rows) =>
                    rows.map((item) => (item.key === row.key ? { ...item, restaurantId: e.target.value } : item)),
                  )
                }
              >
                <option value="">Restaurant</option>
                {(restaurantsQuery.data ?? []).map((restaurant) => (
                  <option key={restaurant.id} value={restaurant.id}>
                    {restaurant.name}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        </div>
      </Card>

      {formError ? <p className="text-sm text-danger">{formError}</p> : null}
      {prerequisiteErrors.map((message) => (
        <p key={message} className="text-sm text-danger">
          {message}
        </p>
      ))}
      {saveDraft.error ? <p className="text-sm text-danger">{saveDraft.error.message}</p> : null}
      {approve.error ? <p className="text-sm text-danger">{approve.error.message}</p> : null}
      {discardDraft.error ? <p className="text-sm text-danger">{discardDraft.error.message}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button onClick={calculate} disabled={!prerequisitesReady}>
          Calculate
        </Button>
        <Button
          variant="outline"
          disabled={!result || saveDraft.isPending}
          onClick={() => {
            void persist().then((id) => {
              if (id && !runId) navigate(`/payroll/runs/${id}/edit`);
            });
          }}
        >
          Save draft
        </Button>
        <Button disabled={!approval.ok || saveDraft.isPending || approve.isPending} onClick={() => setConfirmApprove(true)}>
          Approve
        </Button>
        {runId ? (
          <Button
            variant="danger"
            disabled={discardDraft.isPending || saveDraft.isPending || approve.isPending}
            onClick={() => setConfirmDiscard(true)}
          >
            Discard
          </Button>
        ) : null}
        {runId ? (
          <Link className="inline-flex items-center text-sm font-medium text-wine" to={`/payroll/runs/${runId}`}>
            View detail
          </Link>
        ) : null}
      </div>
      {!approval.ok && result ? (
        <ul className="list-disc pl-5 text-sm text-ink">
          {approval.reasons.map((row) => (
            <li key={row}>{row}</li>
          ))}
        </ul>
      ) : null}

      {result ? (
        <div className="grid gap-4">
          <IssuesPanel errors={result.errors} warnings={result.warnings} />
          <ChecksTable checks={result.checks} names={names} numbers={numbers} />
          <RunSummaryPanel result={result} restaurantNames={restaurantNames} />
          {result.checks.map((check) => (
            <CheckDetail
              key={check.employeeId}
              check={check}
              name={names[check.employeeId] ?? check.employeeId}
              number={numbers[check.employeeId]}
            />
          ))}
        </div>
      ) : null}

      <Dialog
        open={confirmApprove}
        onOpenChange={setConfirmApprove}
        title="Approve and lock this run"
        description="Approving locks the run. It cannot be edited. Void is the only later change."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmApprove(false)}>
              Cancel
            </Button>
            <Button
              disabled={saveDraft.isPending || approve.isPending}
              onClick={() => {
                void (async () => {
                  try {
                    const id = await persist();
                    if (!id) return;
                    await approve.mutateAsync(id);
                    setConfirmApprove(false);
                    navigate(`/payroll/runs/${id}`);
                  } catch (error) {
                    setConfirmApprove(false);
                    if (isYtdStaleError(error)) {
                      setResult(null);
                      setBuiltInputs(null);
                      setSettingsSnapshot(null);
                      setComputedFrom(null);
                      setFormError("Recalculate: year-to-date changed");
                      return;
                    }
                    setFormError(error instanceof Error ? error.message : "Could not approve payroll run");
                  }
                })();
              }}
            >
              Approve
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink">
          The saved draft becomes the locked payroll run for check date {checkDate || "—"}.
        </p>
      </Dialog>

      <Dialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Discard this draft"
        description="Discarding deletes this draft and its checks so it no longer blocks later approvals."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDiscard(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={!runId || discardDraft.isPending}
              onClick={() => {
                void (async () => {
                  if (!runId) return;
                  try {
                    await discardDraft.mutateAsync(runId);
                    setConfirmDiscard(false);
                    navigate("/payroll/runs");
                  } catch (error) {
                    setConfirmDiscard(false);
                    setFormError(error instanceof Error ? error.message : "Could not discard payroll draft");
                  }
                })();
              }}
            >
              Discard
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink">This cannot be undone.</p>
      </Dialog>
    </div>
  );
}
