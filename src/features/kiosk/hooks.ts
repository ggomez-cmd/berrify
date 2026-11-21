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

// A wrong PIN comes back as { error } instead of a raised error, so the
// server can record the failed attempt.
function throwIfPinError<T>(data: T | { error: string }): T {
  if (data && typeof data === "object" && "error" in data && typeof data.error === "string") {
    throw new Error(data.error);
  }
  return data as T;
}

export function useKioskUnlock() {
  return useMutation({
    mutationFn: async (pin: string) => {
      const { data, error } = await supabase.rpc("kiosk_unlock_v2", { pin });
      if (error) throw error;
      return throwIfPinError(data as KioskUnlock | { error: string });
    },
  });
}

export function useKioskPunch() {
  return useMutation({
    mutationFn: async (input: { pin: string; event_type: ClockEventType }) => {
      const { data, error } = await supabase.rpc("kiosk_record_clock_event_v2", {
        pin: input.pin,
        event_type: input.event_type,
        client_event_id: newClientEventId(),
        note: null,
      });
      if (error) throw error;
      return throwIfPinError(data as ClockEvent | { error: string });
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
      const { data, error } = await supabase.rpc("kiosk_confirm_exit_v2", { pin });
      if (error) throw error;
      throwIfPinError(data as { ok: true } | { error: string });
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
