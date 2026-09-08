import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth/auth-context";
import { supabase } from "../../lib/supabase";
import type { Employee, Station } from "../../lib/types";

export function useEmployees() {
  const { org } = useAuth();
  return useQuery({
    queryKey: ["employees", org?.id],
    enabled: Boolean(org?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("*")
        .eq("org_id", org!.id)
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as Employee[];
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
        .select("*")
        .eq("org_id", org!.id)
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return (data as Employee | null) ?? null;
    },
  });
}

export type EmployeeInput = {
  full_name: string;
  email: string;
  phone: string;
  position: Station;
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
        hourly_rate: values.hourly_rate,
        active: values.active,
      };
      if (id) {
        const { error } = await supabase.from("employees").update(payload).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("employees").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["employees"] });
      void qc.invalidateQueries({ queryKey: ["my_employee"] });
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
