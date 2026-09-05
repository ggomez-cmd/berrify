import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../auth/auth-context";
import { supabase } from "../../lib/supabase";
import type { StockMovementWithItem } from "../../lib/types";

export function useStockMovements() {
  const { org } = useAuth();
  return useQuery({
    queryKey: ["stock_movements", org?.id],
    enabled: Boolean(org?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_movements")
        .select("*, inventory_items(id, name, unit, sku)")
        .eq("org_id", org!.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as StockMovementWithItem[];
    },
  });
}
