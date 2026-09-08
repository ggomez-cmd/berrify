import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth/auth-context";
import { supabase } from "../../lib/supabase";
import type { Supplier } from "../../lib/types";

export function useSuppliers() {
  const { org } = useAuth();
  return useQuery({
    queryKey: ["suppliers", org?.id],
    enabled: Boolean(org?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("*")
        .eq("org_id", org!.id)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Supplier[];
    },
  });
}

export type SupplierInput = {
  name: string;
  contact_email: string;
  phone: string;
  notes: string;
};

export function useUpsertSupplier() {
  const { org } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: SupplierInput }) => {
      if (!org) throw new Error("No organization");
      const payload = {
        org_id: org.id,
        name: values.name,
        contact_email: values.contact_email || null,
        phone: values.phone || null,
        notes: values.notes || null,
      };
      if (id) {
        const { error } = await supabase.from("suppliers").update(payload).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("suppliers").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["suppliers"] });
      void qc.invalidateQueries({ queryKey: ["inventory_items"] });
    },
  });
}

export function useDeleteSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("suppliers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["suppliers"] });
      void qc.invalidateQueries({ queryKey: ["inventory_items"] });
    },
  });
}
