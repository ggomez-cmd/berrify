import { describe, expect, it } from "vitest";
import {
  braceGuid,
  buildQwcXml,
  DEFAULT_PUBLIC_APP_URL,
  publicAppUrl,
  qbwcAppSupportUrl,
  qbwcAppUrl,
} from "./qbwc-qwc";

const ownerId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const fileId = "11111111-2222-4333-8444-555555555555";

describe("QWC XML", () => {
  it("builds a QBFS Berrify.qwc with stable OwnerID and FileID", () => {
    const xml = buildQwcXml({
      appUrl: qbwcAppUrl(DEFAULT_PUBLIC_APP_URL),
      appSupport: qbwcAppSupportUrl(DEFAULT_PUBLIC_APP_URL),
      userName: "bfy_user",
      ownerId,
      fileId,
      includeScheduler: false,
    });
    expect(xml).toContain("<AppName>Berrify</AppName>");
    expect(xml).toContain("<AppURL>https://berrify.app/api/qbwc</AppURL>");
    expect(xml).toContain("<AppSupport>https://berrify.app/quickbooks</AppSupport>");
    expect(xml).toContain("<UserName>bfy_user</UserName>");
    expect(xml).toContain(`<OwnerID>${braceGuid(ownerId)}</OwnerID>`);
    expect(xml).toContain(`<FileID>${braceGuid(fileId)}</FileID>`);
    expect(xml).toContain("<QBType>QBFS</QBType>");
    expect(xml).not.toContain("<Scheduler>");
  });

  it("adds a scheduler only after first success", () => {
    const waiting = buildQwcXml({
      appUrl: "https://berrify.app/api/qbwc",
      appSupport: "https://berrify.app/quickbooks",
      userName: "bfy_user",
      ownerId,
      fileId,
      includeScheduler: false,
    });
    const connected = buildQwcXml({
      appUrl: "https://berrify.app/api/qbwc",
      appSupport: "https://berrify.app/quickbooks",
      userName: "bfy_user",
      ownerId,
      fileId,
      includeScheduler: true,
    });
    expect(waiting).not.toContain("RunEveryNMinutes");
    expect(connected).toContain("<RunEveryNMinutes>60</RunEveryNMinutes>");
    expect(connected).toContain(`<OwnerID>${braceGuid(ownerId)}</OwnerID>`);
  });

  it("defaults PUBLIC_APP_URL to https://berrify.app", () => {
    expect(publicAppUrl(undefined)).toBe("https://berrify.app");
    expect(publicAppUrl("")).toBe("https://berrify.app");
    expect(qbwcAppUrl(publicAppUrl("https://example.test/"))).toBe("https://example.test/api/qbwc");
  });
});
