import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth/auth-context";
import { toThrownError } from "../../lib/thrown-error";
import { isManager } from "../../lib/schedule";
import { supabase } from "../../lib/supabase";
import type {
  EmptyBottleEvent,
  EmptyBottleEventWithRelations,
  EmptyBottleLine,
  InventoryItem,
} from "../../lib/types";

const EVENT_LIST_SELECT =
  "id, org_id, telegram_message_id, chat_id, restaurant_id, proposed_item_id, proposed_label, status, source, image_mime, vision_count, gemini_count, created_at, restaurants(id, name), empty_bottle_lines(id, event_id, org_id, proposed_item_id, proposed_label, qty, sort)";

export function useEmptyBottleEvents() {
  const { org, role } = useAuth();
  return useQuery({
    queryKey: ["empty_bottle_events", org?.id],
    enabled: Boolean(org?.id) && isManager(role),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empty_bottle_events")
        .select(EVENT_LIST_SELECT)
        .eq("org_id", org!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        ...(row as unknown as EmptyBottleEventWithRelations),
        image_data: null,
        empty_bottle_lines: [...((row as unknown as EmptyBottleEventWithRelations).empty_bottle_lines ?? [])].sort(
          (a, b) => a.sort - b.sort,
        ),
      }));
    },
  });
}

export function useEmptyBottleMedia(eventId: string | null) {
  return useQuery({
    queryKey: ["empty_bottle_media", eventId],
    enabled: Boolean(eventId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empty_bottle_events")
        .select("image_data, image_mime")
        .eq("id", eventId!)
        .single();
      if (error) throw error;
      return data as Pick<EmptyBottleEvent, "image_data" | "image_mime">;
    },
  });
}

export function useEmptyBottleCatalog() {
  const { org, role } = useAuth();
  return useQuery({
    queryKey: ["empty_bottle_catalog", org?.id],
    enabled: Boolean(org?.id) && isManager(role),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("id, name, sku")
        .eq("org_id", org!.id)
        .like("sku", "BV-EB-%")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Array<Pick<InventoryItem, "id" | "name" | "sku">>;
    },
  });
}

export function useSaveEmptyBottleReview() {
  const { org } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      eventId: string;
      restaurantId: string | null;
      lines: Array<{
        id?: string;
        proposed_item_id: string | null;
        proposed_label: string;
        qty: number;
      }>;
    }) => {
      if (!org) throw new Error("No organization");
      const { error: eventError } = await supabase
        .from("empty_bottle_events")
        .update({ restaurant_id: input.restaurantId })
        .eq("id", input.eventId)
        .eq("org_id", org.id);
      if (eventError) throw toThrownError(eventError, "Could not save empty bottles");

      const { data: existing, error: loadError } = await supabase
        .from("empty_bottle_lines")
        .select("id")
        .eq("event_id", input.eventId);
      if (loadError) throw toThrownError(loadError, "Could not save empty bottles");
      const keep = new Set(input.lines.map((line) => line.id).filter((id): id is string => Boolean(id)));
      const remove = (existing ?? []).map((row) => row.id).filter((id) => !keep.has(id));
      if (remove.length > 0) {
        const { error } = await supabase.from("empty_bottle_lines").delete().in("id", remove);
        if (error) throw toThrownError(error, "Could not save empty bottles");
      }
      for (const [sort, line] of input.lines.entries()) {
        const row = {
          event_id: input.eventId,
          org_id: org.id,
          proposed_item_id: line.proposed_item_id,
          proposed_label: line.proposed_label,
          qty: line.qty,
          sort,
        };
        if (line.id) {
          const { error } = await supabase.from("empty_bottle_lines").update(row).eq("id", line.id);
          if (error) throw toThrownError(error, "Could not save empty bottles");
        } else {
          const { error } = await supabase.from("empty_bottle_lines").insert(row);
          if (error) throw toThrownError(error, "Could not save empty bottles");
        }
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["empty_bottle_events"] });
    },
  });
}

export function useConfirmEmptyBottle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (eventId: string) => {
      const { error } = await supabase.rpc("confirm_empty_bottle", { p_event_id: eventId });
      if (error) throw toThrownError(error, "Could not confirm empty bottles");
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["empty_bottle_events"] });
      void qc.invalidateQueries({ queryKey: ["stock_movements"] });
      void qc.invalidateQueries({ queryKey: ["inventory_items"] });
    },
  });
}

export function useCancelEmptyBottle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (eventId: string) => {
      const { error } = await supabase.rpc("cancel_empty_bottle", { p_event_id: eventId });
      if (error) throw toThrownError(error, "Could not cancel empty bottles");
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["empty_bottle_events"] });
    },
  });
}

export type { EmptyBottleLine };
