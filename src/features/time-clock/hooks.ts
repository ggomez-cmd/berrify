import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth/auth-context";
import { addCalendarDays } from "../../lib/payroll-engine/hours/time";
import { isManager } from "../../lib/schedule";
import { supabase } from "../../lib/supabase";
import type { ClockEventType } from "../../lib/time-clock";
import type { ApprovedTimeClockWindow, TimeEntryRpcPayload } from "../../lib/time-entries/edit";
import { toThrownError } from "../../lib/thrown-error";
import type {
  ClockEvent,
  ClockSession,
  TimeBreak,
  TimeEntry,
  TimeEntryEdit,
  TimeException,
  WhosWorkingRow,
} from "../../lib/types";

function newClientEventId(): string {
  return crypto.randomUUID();
}

export function useMyClockSession() {
  const { org, user } = useAuth();
  return useQuery({
    queryKey: ["clock_session", org?.id, user?.id],
    enabled: Boolean(org?.id && user?.id),
    queryFn: async () => {
      const { data: employee, error: employeeError } = await supabase
        .from("employees")
        .select("id")
        .eq("org_id", org!.id)
        .eq("user_id", user!.id)
        .maybeSingle();
      if (employeeError) throw employeeError;
      if (!employee) return null;
      const { data, error } = await supabase
        .from("clock_sessions")
        .select("*")
        .eq("employee_id", employee.id)
        .maybeSingle();
      if (error) throw error;
      return (data as ClockSession | null) ?? null;
    },
  });
}

export function useMyClockEvents() {
  const { org, user } = useAuth();
  return useQuery({
    queryKey: ["clock_events", org?.id, user?.id],
    enabled: Boolean(org?.id && user?.id),
    queryFn: async () => {
      const { data: employee, error: employeeError } = await supabase
        .from("employees")
        .select("id")
        .eq("org_id", org!.id)
        .eq("user_id", user!.id)
        .maybeSingle();
      if (employeeError) throw employeeError;
      if (!employee) return [];
      const { data, error } = await supabase
        .from("clock_events")
        .select("*")
        .eq("employee_id", employee.id)
        .order("occurred_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as ClockEvent[];
    },
  });
}

export function useRecordClockEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { event_type: ClockEventType; note?: string }) => {
      const { data, error } = await supabase.rpc("record_clock_event", {
        event_type: input.event_type,
        client_event_id: newClientEventId(),
        note: input.note ?? null,
        client_occurred_at: new Date().toISOString(),
        restaurant_id: null,
        latitude: null,
        longitude: null,
        accuracy_m: null,
        source: "web",
      });
      if (error) throw error;
      return data as ClockEvent;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["clock_session"] });
      void qc.invalidateQueries({ queryKey: ["clock_events"] });
      void qc.invalidateQueries({ queryKey: ["time_entries"] });
      void qc.invalidateQueries({ queryKey: ["time_exceptions"] });
      void qc.invalidateQueries({ queryKey: ["whos_working"] });
    },
  });
}

export function useWhosWorking() {
  const { org } = useAuth();
  return useQuery({
    queryKey: ["whos_working", org?.id],
    enabled: Boolean(org?.id),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_whos_working");
      if (error) throw error;
      return (data ?? []) as WhosWorkingRow[];
    },
  });
}

export function useOrgClockEvents() {
  const { org } = useAuth();
  return useQuery({
    queryKey: ["clock_events", "org", org?.id],
    enabled: Boolean(org?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clock_events")
        .select("*, employees(full_name)")
        .eq("org_id", org!.id)
        .order("occurred_at", { ascending: false })
        .limit(80);
      if (error) throw error;
      return (data ?? []) as Array<ClockEvent & { employees: { full_name: string } | null }>;
    },
  });
}

export function useTimeEntries() {
  const { org } = useAuth();
  return useQuery({
    queryKey: ["time_entries", org?.id],
    enabled: Boolean(org?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("time_entries")
        .select("*, employees(full_name)")
        .eq("org_id", org!.id)
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as Array<TimeEntry & { employees: { full_name: string } | null }>;
    },
  });
}

export function useTimeExceptions() {
  const { org } = useAuth();
  return useQuery({
    queryKey: ["time_exceptions", org?.id],
    enabled: Boolean(org?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("time_exceptions")
        .select("*, employees(full_name)")
        .eq("org_id", org!.id)
        .order("created_at", { ascending: false })
        .limit(80);
      if (error) throw error;
      return (data ?? []) as Array<TimeException & { employees: { full_name: string } | null }>;
    },
  });
}

export function useManagerForceClockOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { employee_id: string; reason: string }) => {
      const { data, error } = await supabase.rpc("manager_force_clock_out", {
        employee_id: input.employee_id,
        reason: input.reason,
        client_event_id: newClientEventId(),
        occurred_at: new Date().toISOString(),
      });
      if (error) throw error;
      return data as ClockEvent;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["clock_session"] });
      void qc.invalidateQueries({ queryKey: ["clock_events"] });
      void qc.invalidateQueries({ queryKey: ["time_entries"] });
      void qc.invalidateQueries({ queryKey: ["time_exceptions"] });
      void qc.invalidateQueries({ queryKey: ["whos_working"] });
    },
  });
}

export function useManagerRecordPunch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      employee_id: string;
      event_type: ClockEventType;
      occurred_at: string;
      reason: string;
    }) => {
      const { data, error } = await supabase.rpc("manager_record_punch", {
        employee_id: input.employee_id,
        event_type: input.event_type,
        occurred_at: input.occurred_at,
        reason: input.reason,
        client_event_id: newClientEventId(),
      });
      if (error) throw error;
      return data as ClockEvent;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["clock_session"] });
      void qc.invalidateQueries({ queryKey: ["clock_events"] });
      void qc.invalidateQueries({ queryKey: ["time_entries"] });
      void qc.invalidateQueries({ queryKey: ["time_exceptions"] });
      void qc.invalidateQueries({ queryKey: ["whos_working"] });
    },
  });
}

export function useReconcileAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("reconcile_attendance");
      if (error) throw error;
      return data as number;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["time_exceptions"] });
    },
  });
}

export function useResolveException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { exception_id: string; new_status: "resolved" | "dismissed" }) => {
      const { data, error } = await supabase.rpc("resolve_time_exception", input);
      if (error) throw error;
      return data as TimeException;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["time_exceptions"] });
      void qc.invalidateQueries({ queryKey: ["time_entries"] });
    },
  });
}

function invalidateTimeEntryQueries(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["time_entry_review"] });
  void qc.invalidateQueries({ queryKey: ["payroll_run_time_entries"] });
  void qc.invalidateQueries({ queryKey: ["time_entries"] });
  void qc.invalidateQueries({ queryKey: ["time_exceptions"] });
}

export function useTimeEntryReview(periodStart: string, periodEnd: string) {
  const { org, role } = useAuth();
  const lookback = periodStart ? addCalendarDays(periodStart, -8) : "";
  const until = periodEnd ? addCalendarDays(periodEnd, 2) : "";
  return useQuery({
    queryKey: ["time_entry_review", org?.id, periodStart, periodEnd],
    enabled: Boolean(org?.id && periodStart && periodEnd) && isManager(role),
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
      let exceptions: TimeException[] = [];
      let edits: TimeEntryEdit[] = [];
      if (ids.length > 0) {
        const [breakResult, exceptionResult, editResult] = await Promise.all([
          supabase.from("time_breaks").select("*").eq("org_id", org!.id).in("time_entry_id", ids),
          supabase.from("time_exceptions").select("*").eq("org_id", org!.id).in("time_entry_id", ids),
          supabase.from("time_entry_edits").select("*").eq("org_id", org!.id).in("time_entry_id", ids).order("edited_at"),
        ]);
        if (breakResult.error) throw toThrownError(breakResult.error, "Could not load time breaks");
        if (exceptionResult.error) throw toThrownError(exceptionResult.error, "Could not load time exceptions");
        if (editResult.error) throw toThrownError(editResult.error, "Could not load shift edits");
        breaks = (breakResult.data ?? []) as TimeBreak[];
        exceptions = (exceptionResult.data ?? []) as TimeException[];
        edits = (editResult.data ?? []) as TimeEntryEdit[];
      }
      const { data: windows, error: windowError } = await supabase.rpc("list_approved_time_clock_windows", {
        target_org_id: org!.id,
      });
      if (windowError) throw toThrownError(windowError, "Could not load approved payroll windows");
      return {
        entries: rows,
        breaks,
        exceptions,
        edits,
        windows: (windows ?? []) as ApprovedTimeClockWindow[],
      };
    },
  });
}

export function useSaveTimeEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: TimeEntryRpcPayload) => {
      const { data, error } = await supabase.rpc("manager_save_time_entry", input);
      if (error || !data) throw toThrownError(error, "Could not save shift");
      return data as string;
    },
    onSettled: () => invalidateTimeEntryQueries(qc),
  });
}

export function useVoidTimeEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { target_entry_id: string; reason: string }) => {
      const { error } = await supabase.rpc("manager_void_time_entry", input);
      if (error) throw toThrownError(error, "Could not void shift");
    },
    onSettled: () => invalidateTimeEntryQueries(qc),
  });
}

export function useUpdateOrgClockSettings() {
  const { org } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: {
      timezone: string;
      workweek_start_dow: number;
      workweek_start_time: string;
      default_meal_break_paid: boolean;
      default_rest_break_paid: boolean;
    }) => {
      if (!org) throw new Error("No organization");
      const { error } = await supabase.rpc("update_org_clock_settings", values);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries();
    },
  });
}
