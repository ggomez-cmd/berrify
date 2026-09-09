import { useMutation, useQuery } from "@tanstack/react-query";
import type { ClockEventType, ClockState } from "../../lib/time-clock";
import { supabase } from "../../lib/supabase";
import type { ClockEvent } from "../../lib/types";

export type KioskUnlock = {
  id: string;
  full_name: string;
  position: string;
  state: ClockState;
  clocked_in_at: string | null;
  break_started_at: string | null;
};

function newClientEventId(): string {
  return crypto.randomUUID();
}

export function useKioskUnlock() {
  return useMutation({
    mutationFn: async (pin: string) => {
      const { data, error } = await supabase.rpc("kiosk_unlock", { pin });
      if (error) throw error;
      return data as KioskUnlock;
    },
  });
}

export function useKioskPunch() {
  return useMutation({
    mutationFn: async (input: { pin: string; event_type: ClockEventType }) => {
      const { data, error } = await supabase.rpc("kiosk_record_clock_event", {
        pin: input.pin,
        event_type: input.event_type,
        client_event_id: newClientEventId(),
        note: null,
      });
      if (error) throw error;
      return data as ClockEvent;
    },
  });
}

export function useKioskExitRequired() {
  return useQuery({
    queryKey: ["kiosk_exit_required"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("kiosk_exit_required");
      if (error) throw error;
      return Boolean(data);
    },
  });
}

export function useKioskConfirmExit() {
  return useMutation({
    mutationFn: async (pin: string) => {
      const { error } = await supabase.rpc("kiosk_confirm_exit", { pin });
      if (error) throw error;
    },
  });
}

export function useSetOwnerKioskPin() {
  return useMutation({
    mutationFn: async (pin: string) => {
      const { error } = await supabase.rpc("set_owner_kiosk_pin", { pin });
      if (error) throw error;
    },
  });
}
