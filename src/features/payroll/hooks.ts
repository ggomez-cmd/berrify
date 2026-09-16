import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth/auth-context";
import type { PayrollLine } from "../../lib/payroll";
import { isManager } from "../../lib/schedule";
import { supabase } from "../../lib/supabase";
import { toThrownError } from "../../lib/thrown-error";
import type { ClockSession, PayrollExport, TimeEntry, TimeException } from "../../lib/types";

export function usePayrollTimeEntries(restaurantId: string | null, periodStart: Date | null, periodEnd: Date | null) {
  const { org, role } = useAuth();
  return useQuery({
    queryKey: [
      "payroll_time_entries",
      org?.id,
      restaurantId,
      periodStart?.toISOString(),
      periodEnd?.toISOString(),
    ],
    enabled: Boolean(org?.id && restaurantId && periodStart && periodEnd) && isManager(role),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("time_entries")
        .select("*")
        .eq("org_id", org!.id)
        .eq("restaurant_id", restaurantId!)
        .gte("started_at", periodStart!.toISOString())
        .lt("started_at", periodEnd!.toISOString())
        .order("started_at", { ascending: true });
      if (error) throw toThrownError(error, "Could not load time entries");
      return (data ?? []) as TimeEntry[];
    },
  });
}

export function usePayrollExceptions() {
  const { org, role } = useAuth();
  return useQuery({
    queryKey: ["payroll_time_exceptions", org?.id],
    enabled: Boolean(org?.id) && isManager(role),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("time_exceptions")
        .select("id, employee_id, time_entry_id, status, created_at")
        .eq("org_id", org!.id)
        .eq("status", "open");
      if (error) throw toThrownError(error, "Could not load exceptions");
      return (data ?? []) as Array<
        Pick<TimeException, "id" | "employee_id" | "time_entry_id" | "status" | "created_at">
      >;
    },
  });
}

export function usePayrollOpenSessions(restaurantId: string | null) {
  const { org, role } = useAuth();
  return useQuery({
    queryKey: ["payroll_clock_sessions", org?.id, restaurantId],
    enabled: Boolean(org?.id && restaurantId) && isManager(role),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clock_sessions")
        .select("employee_id, restaurant_id, clocked_in_at")
        .eq("org_id", org!.id)
        .eq("restaurant_id", restaurantId!);
      if (error) throw toThrownError(error, "Could not load open sessions");
      return (data ?? []) as Array<Pick<ClockSession, "employee_id" | "restaurant_id" | "clocked_in_at">>;
    },
  });
}

export function useSavePayrollExport() {
  const { org, user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      restaurantId: string;
      periodStart: Date;
      periodEnd: Date;
      lines: PayrollLine[];
    }) => {
      if (!org) throw new Error("No organization");
      const { data, error } = await supabase
        .from("payroll_exports")
        .insert({
          org_id: org.id,
          restaurant_id: input.restaurantId,
          period_start: input.periodStart.toISOString(),
          period_end: input.periodEnd.toISOString(),
          created_by: user?.id ?? null,
        })
        .select("id")
        .single();
      if (error || !data) throw toThrownError(error, "Could not save payroll export");
      if (input.lines.length > 0) {
        const { error: lineError } = await supabase.from("payroll_export_lines").insert(
          input.lines.map((line) => ({
            org_id: org.id,
            payroll_export_id: data.id,
            employee_id: line.employee_id,
            regular_seconds: line.regular_seconds,
            ot_seconds: line.ot_seconds,
            hourly_rate: line.hourly_rate,
            gross: line.gross,
          })),
        );
        if (lineError) throw toThrownError(lineError, "Could not save payroll export lines");
      }
      return data as Pick<PayrollExport, "id">;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["payroll_exports"] });
    },
  });
}
