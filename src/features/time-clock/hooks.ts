import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth/auth-context";
import type { ClockEventType } from "../../lib/time-clock";
import { supabase } from "../../lib/supabase";
import type {
  ClockEvent,
  ClockSession,
  TimeEntry,
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
