import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth/auth-context";
import { isManager } from "../../lib/schedule";
import { supabase } from "../../lib/supabase";
import type { Employee, LoginRole, Station } from "../../lib/types";

export function useEmployees() {
  const { org, role } = useAuth();
  return useQuery({
    queryKey: ["employees", org?.id],
    enabled: Boolean(org?.id) && isManager(role),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_employees_full");
      if (error) throw error;
      return ((data ?? []) as Employee[]).sort((a, b) => a.full_name.localeCompare(b.full_name));
    },
  });
}

export function useMyEmployee() {
  const { org, user } = useAuth();
  return useQuery({
    queryKey: ["my_employee", org?.id, user?.id],
    enabled: Boolean(org?.id && user?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, org_id, user_id, full_name, position, active, home_restaurant_id, created_at, updated_at")
        .eq("org_id", org!.id)
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        ...(data as Employee),
        email: null,
        phone: null,
        login_role: "staff",
        hourly_rate: 0,
        invite_code: null,
      } satisfies Employee;
    },
  });
}

export type EmployeeInput = {
  full_name: string;
  email: string;
  phone: string;
  position: Station;
  login_role: LoginRole;
  hourly_rate: number;
  active: boolean;
};

export function useUpsertEmployee() {
  const { org } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: EmployeeInput }) => {
      if (!org) throw new Error("No organization");
      const payload = {
        org_id: org.id,
        full_name: values.full_name,
        email: values.email || null,
        phone: values.phone || null,
        position: values.position,
        login_role: values.login_role,
        hourly_rate: values.hourly_rate,
        active: values.active,
      };
      if (id) {
        const { error } = await supabase.from("employees").update(payload).eq("id", id);
        if (error) throw error;
        return id;
      }
      const { data, error } = await supabase.from("employees").insert(payload).select("id").single();
      if (error || !data) throw error ?? new Error("Failed to save employee");
      return data.id as string;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["employees"] });
      void qc.invalidateQueries({ queryKey: ["my_employee"] });
    },
  });
}

export function useSetClockPin() {
  return useMutation({
    mutationFn: async ({ id, pin }: { id: string; pin: string }) => {
      const { error } = await supabase.rpc("set_employee_clock_pin", {
        employee_id: id,
        pin,
      });
      if (error) throw error;
    },
  });
}

export function useRotateInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("rotate_employee_invite", { target_id: id });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["employees"] });
    },
  });
}

export function useDeleteEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("employees").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["employees"] });
      void qc.invalidateQueries({ queryKey: ["shifts"] });
    },
  });
}
