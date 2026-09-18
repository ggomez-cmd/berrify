import { describe, expect, it } from "vitest";
import { EMPTY_BOTTLE_IDENTIFY_UNAVAILABLE } from "./empty-bottle";
import { identifyEmptyBottlesFromPhoto } from "./empty-bottle-identify-api";

describe("identifyEmptyBottlesFromPhoto", () => {
  it("posts the photo with a session token", async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(String(input)).toBe("/api/empty-bottle-identify");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer user-token");
      return Response.json({
        event_id: "evt-1",
        vision_count: 11,
        gemini_count: 9,
        proposed_label: "9 bottles",
        lines: [],
      });
    };
    await expect(
      identifyEmptyBottlesFromPhoto({
        image: "data:image/jpeg;base64,/9j/4AAQ",
        fetchImpl,
        getAccessToken: async () => "user-token",
      }),
    ).resolves.toMatchObject({ event_id: "evt-1", gemini_count: 9 });
  });

  it("surfaces a missing Gemini key as identify unavailable", async () => {
    const fetchImpl: typeof fetch = async () => Response.json({ error: "Empty-bottle identify is unavailable" }, { status: 503 });
    await expect(
      identifyEmptyBottlesFromPhoto({
        image: "data:image/jpeg;base64,/9j/4AAQ",
        fetchImpl,
        getAccessToken: async () => "user-token",
      }),
    ).rejects.toThrow(EMPTY_BOTTLE_IDENTIFY_UNAVAILABLE);
  });
});
