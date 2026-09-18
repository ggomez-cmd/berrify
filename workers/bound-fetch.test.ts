import { describe, expect, it } from "vitest";
import { boundAssetFetch, boundFetch } from "./bound-fetch";

describe("bound fetch helpers", () => {
  it("calls ASSETS.fetch with the binding as this", async () => {
    const assets = {
      fetch(this: unknown, request: Request) {
        expect(this).toBe(assets);
        return new Response(request.url, { status: 200 });
      },
    };
    const response = await boundAssetFetch(assets, new Request("https://berrify.example/empty-bottles"));
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("https://berrify.example/empty-bottles");
  });

  it("forwards to globalThis.fetch", async () => {
    expect(typeof boundFetch).toBe("function");
    expect(boundFetch).not.toBe(fetch);
  });
});
