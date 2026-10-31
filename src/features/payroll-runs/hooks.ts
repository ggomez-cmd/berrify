import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addCalendarDays } from "../../lib/payroll-engine/hours/time";
import type { TimeBreakRow, TimeEntryRow } from "../../lib/payroll-engine/hours/types";
import type { PayrollCheckDraftPayload, PayrollRunDraftPayload } from "../../lib/payroll/runs";
import { isAdmin } from "../../lib/schedule";
import { supabase } from "../../lib/supabase";
import { toThrownError } from "../../lib/thrown-error";
import type { PayrollRunRow, PayrollRunWithChecks, TimeBreak, TimeEntry } from "../../lib/types";
import { useAuth } from "../../auth/auth-context";

export function usePayrollRuns() {
  const { org, role } = useAuth();
  return useQuery({
    queryKey: ["payroll_runs", org?.id],
    enabled: Boolean(org?.id) && isAdmin(role),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_runs")
        .select("*")
        .eq("org_id", org!.id)
        .order("check_date", { ascending: false });
      if (error) throw toThrownError(error, "Could not load payroll runs");
      return (data ?? []) as PayrollRunRow[];
    },
  });
}

export function usePayrollRun(runId: string | undefined) {
  const { org, role } = useAuth();
  return useQuery({
    queryKey: ["payroll_run", org?.id, runId],
    enabled: Boolean(org?.id && runId) && isAdmin(role),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_runs")
        .select("*, payroll_checks(*, payroll_check_earnings(*), payroll_check_taxes(*))")
        .eq("org_id", org!.id)
        .eq("id", runId!)
        .single();
      if (error || !data) throw toThrownError(error, "Could not load payroll run");
      return data as PayrollRunWithChecks;
    },
  });
}

export function usePayrollRunHistory() {
  const { org, role } = useAuth();
  return useQuery({
    queryKey: ["payroll_run_history", org?.id],
    enabled: Boolean(org?.id) && isAdmin(role),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_runs")
        .select("check_date, status, payroll_checks(employee_id, gross_cents, payroll_check_taxes(side, tax_code, taxable_cents, amount_cents))")
        .eq("org_id", org!.id)
        .in("status", ["approved", "void"]);
      if (error) throw toThrownError(error, "Could not load payroll history");
      return (data ?? []) as PayrollRunWithChecks[];
    },
  });
}

export function usePayrollRunTimeEntries(periodStart: string, periodEnd: string) {
  const { org, role } = useAuth();
  const lookback = periodStart ? addCalendarDays(periodStart, -8) : "";
  const until = periodEnd ? addCalendarDays(periodEnd, 2) : "";
  return useQuery({
    queryKey: ["payroll_run_time_entries", org?.id, lookback, until],
    enabled: Boolean(org?.id && periodStart && periodEnd) && isAdmin(role),
    queryFn: async () => {
      const { data: entries, error } = await supabase
        .from("time_entries")
        .select("*")
        .eq("org_id", org!.id)
        .not("ended_at", "is", null)
        .gte("started_at", `${lookback}T00:00:00.000Z`)
        .lt("started_at", `${until}T00:00:00.000Z`)
        .order("started_at", { ascending: true });
      if (error) throw toThrownError(error, "Could not load time entries");
      const rows = (entries ?? []) as TimeEntry[];
      const ids = rows.map((row) => row.id);
      let breaks: TimeBreak[] = [];
      if (ids.length > 0) {
        const { data: breakRows, error: breakError } = await supabase
          .from("time_breaks")
          .select("*")
          .eq("org_id", org!.id)
          .in("time_entry_id", ids);
        if (breakError) throw toThrownError(breakError, "Could not load time breaks");
        breaks = (breakRows ?? []) as TimeBreak[];
      }
      const timeEntries: TimeEntryRow[] = rows.flatMap((row) => {
        if (!row.restaurant_id || !row.ended_at) return [];
        return [
          {
            id: row.id,
            employee_id: row.employee_id,
            restaurant_id: row.restaurant_id,
            position: row.position,
            started_at: row.started_at,
            ended_at: row.ended_at,
          },
        ];
      });
      const timeBreaks: TimeBreakRow[] = breaks.map((row) => ({
        time_entry_id: row.time_entry_id,
        started_at: row.started_at,
        ended_at: row.ended_at,
        break_type: row.break_type,
        paid: row.paid,
      }));
      return { timeEntries, timeBreaks };
    },
  });
}

export function useSavePayrollRunDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      runId: string | null;
      run: PayrollRunDraftPayload;
      checks: PayrollCheckDraftPayload[];
    }) => {
      const { data, error } = await supabase.rpc("save_payroll_run_draft", {
        target_run_id: input.runId,
        run: input.run,
        checks: input.checks,
      });
      if (error || !data) throw toThrownError(error, "Could not save payroll draft");
      return data as string;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["payroll_runs"] });
      void qc.invalidateQueries({ queryKey: ["payroll_run"] });
      void qc.invalidateQueries({ queryKey: ["payroll_run_history"] });
    },
  });
}

export function useApprovePayrollRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      const { error } = await supabase.rpc("approve_payroll_run", { target_run_id: runId });
      if (error) throw toThrownError(error, "Could not approve payroll run");
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["payroll_runs"] });
      void qc.invalidateQueries({ queryKey: ["payroll_run"] });
      void qc.invalidateQueries({ queryKey: ["payroll_run_history"] });
    },
  });
}

export function useDiscardPayrollRunDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => {
      const { error } = await supabase.rpc("discard_payroll_run_draft", { target_run_id: runId });
      if (error) throw toThrownError(error, "Could not discard payroll draft");
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["payroll_runs"] });
      void qc.invalidateQueries({ queryKey: ["payroll_run"] });
      void qc.invalidateQueries({ queryKey: ["payroll_run_history"] });
    },
  });
}

export function useVoidPayrollRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { runId: string; reason: string }) => {
      const { error } = await supabase.rpc("void_payroll_run", {
        target_run_id: input.runId,
        reason: input.reason,
      });
      if (error) throw toThrownError(error, "Could not void payroll run");
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["payroll_runs"] });
      void qc.invalidateQueries({ queryKey: ["payroll_run"] });
      void qc.invalidateQueries({ queryKey: ["payroll_run_history"] });
    },
  });
}

