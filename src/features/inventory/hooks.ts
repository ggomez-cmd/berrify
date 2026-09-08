import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth/auth-context";
import { supabase } from "../../lib/supabase";
import type { InventoryItem, InventoryItemWithSupplier, MovementReason } from "../../lib/types";

export function useInventoryItems() {
  const { org } = useAuth();
  return useQuery({
    queryKey: ["inventory_items", org?.id],
    enabled: Boolean(org?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("*, suppliers(id, name)")
        .eq("org_id", org!.id)
        .order("name");
      if (error) throw error;
      return (data ?? []) as InventoryItemWithSupplier[];
    },
  });
}

export type ItemInput = {
  name: string;
  sku: string;
  category: string;
  unit: string;
  quantity: number;
  reorder_level: number;
  unit_cost: number;
  supplier_id: string | null;
};

export function useUpsertItem() {
  const { org } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: ItemInput }) => {
      if (!org) throw new Error("No organization");
      const payload = {
        org_id: org.id,
        name: values.name,
        sku: values.sku || null,
        category: values.category || null,
        unit: values.unit,
        quantity: values.quantity,
        reorder_level: values.reorder_level,
        unit_cost: values.unit_cost,
        supplier_id: values.supplier_id,
      };
      if (id) {
        const { quantity: _qty, ...rest } = payload;
        void _qty;
        const { error } = await supabase.from("inventory_items").update(rest).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("inventory_items").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["inventory_items"] });
      void qc.invalidateQueries({ queryKey: ["stock_movements"] });
    },
  });
}

export function useDeleteItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("inventory_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["inventory_items"] });
      void qc.invalidateQueries({ queryKey: ["stock_movements"] });
    },
  });
}

export function useAdjustStock() {
  const { org, user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      item: InventoryItem;
      delta: number;
      reason: MovementReason;
      note: string;
    }) => {
      if (!org) throw new Error("No organization");
      const { error } = await supabase.from("stock_movements").insert({
        org_id: org.id,
        item_id: input.item.id,
        delta: input.delta,
        reason: input.reason,
        note: input.note || null,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["inventory_items"] });
      void qc.invalidateQueries({ queryKey: ["stock_movements"] });
    },
  });
}
