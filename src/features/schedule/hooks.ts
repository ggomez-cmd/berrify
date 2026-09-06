import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth/auth-context";
import { supabase } from "../../lib/supabase";
import type { ShiftStatus, ShiftWithEmployee, Station } from "../../lib/types";

export function useShifts() {
  const { org } = useAuth();
  return useQuery({
    queryKey: ["shifts", org?.id],
    enabled: Boolean(org?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_shifts")
        .select("*, employees(id, full_name, position, user_id)")
        .eq("org_id", org!.id)
        .order("starts_at");
      if (error) throw error;
      return (data ?? []) as ShiftWithEmployee[];
    },
  });
}

export type ShiftInput = {
  employee_id: string | null;
  position: Station;
  starts_at: string;
  ends_at: string;
  status: ShiftStatus;
  note: string;
};

export function useUpsertShift() {
  const { org, user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: ShiftInput }) => {
      if (!org) throw new Error("No organization");
      const payload = {
        org_id: org.id,
        employee_id: values.employee_id,
        position: values.position,
        starts_at: values.starts_at,
        ends_at: values.ends_at,
        status: values.status,
        note: values.note || null,
        created_by: user?.id ?? null,
      };
      if (id) {
        const { error } = await supabase.from("staff_shifts").update(payload).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("staff_shifts").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["shifts"] });
    },
  });
}

export function useDeleteShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("staff_shifts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["shifts"] });
    },
  });
}

export function usePublishWeek() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      const { error } = await supabase.from("staff_shifts").update({ status: "published" }).in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["shifts"] });
    },
  });
}

export function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromDatetimeLocal(value: string): string {
  return new Date(value).toISOString();
}
