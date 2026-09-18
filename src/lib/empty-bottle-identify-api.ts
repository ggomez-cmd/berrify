import { EMPTY_BOTTLE_IDENTIFY_UNAVAILABLE } from "./empty-bottle";
import { supabase } from "./supabase";
import type { EmptyBottleLine } from "./types";

export type IdentifyEmptyBottlesResult = {
  event_id: string;
  vision_count: number | null;
  gemini_count: number;
  proposed_label: string;
  lines: Array<Omit<EmptyBottleLine, "id">>;
};

async function defaultAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

function readError(payload: unknown, status: number): string {
  if (payload && typeof payload === "object") {
    const message = (payload as { error?: unknown }).error;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return `Identify failed (${status})`;
}

export async function identifyEmptyBottlesFromPhoto(input: {
  image: string;
  restaurantId?: string | null;
  caption?: string;
  fetchImpl?: typeof fetch;
  getAccessToken?: () => Promise<string | null>;
}): Promise<IdentifyEmptyBottlesResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const token = await (input.getAccessToken ?? defaultAccessToken)();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetchImpl("/api/empty-bottle-identify", {
    method: "POST",
    headers,
    credentials: "same-origin",
    body: JSON.stringify({
      image: input.image,
      restaurant_id: input.restaurantId ?? null,
      caption: input.caption ?? "",
    }),
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (response.status === 503) {
    throw new Error(EMPTY_BOTTLE_IDENTIFY_UNAVAILABLE);
  }
  if (!response.ok) {
    throw new Error(readError(payload, response.status));
  }
  if (!payload || typeof payload !== "object" || typeof (payload as { event_id?: unknown }).event_id !== "string") {
    throw new Error("Identify returned no event");
  }
  return payload as IdentifyEmptyBottlesResult;
}
