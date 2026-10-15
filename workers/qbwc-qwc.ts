import { xmlEscape } from "./qbxml";

export const QBWC_APP_NAME = "Berrify";
export const DEFAULT_PUBLIC_APP_URL = "https://berrify.app";

export type QwcInput = {
  appUrl: string;
  appSupport: string;
  userName: string;
  ownerId: string;
  fileId: string;
  includeScheduler: boolean;
  runEveryNMinutes?: number;
  appName?: string;
};

export function qwcAppName(connectionName: string | null | undefined): string {
  const trimmed = connectionName?.trim() ?? "";
  return trimmed ? `${QBWC_APP_NAME} · ${trimmed}` : QBWC_APP_NAME;
}

export function qwcDownloadFilename(connectionName: string | null | undefined): string {
  const slug = (connectionName ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug ? `Berrify-${slug}.qwc` : "Berrify.qwc";
}

export function publicAppUrl(envUrl: string | undefined): string {
  const trimmed = envUrl?.trim().replace(/\/$/, "");
  return trimmed || DEFAULT_PUBLIC_APP_URL;
}

export function qbwcAppUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/api/qbwc`;
}

export function qbwcAppSupportUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/quickbooks`;
}

export function braceGuid(id: string): string {
  const bare = id.replace(/[{}]/g, "").toLowerCase();
  return `{${bare}}`;
}

export function buildQwcXml(input: QwcInput): string {
  const scheduler = input.includeScheduler
    ? [
        `  <Scheduler>`,
        `    <RunEveryNMinutes>${xmlEscape(String(input.runEveryNMinutes ?? 60))}</RunEveryNMinutes>`,
        `  </Scheduler>`,
      ]
    : [];
  return [
    `<?xml version="1.0"?>`,
    `<QBWCXML>`,
    `  <AppName>${xmlEscape(input.appName ?? QBWC_APP_NAME)}</AppName>`,
    `  <AppID></AppID>`,
    `  <AppURL>${xmlEscape(input.appUrl)}</AppURL>`,
    `  <AppDescription>Berrify QuickBooks Desktop connector</AppDescription>`,
    `  <AppSupport>${xmlEscape(input.appSupport)}</AppSupport>`,
    `  <UserName>${xmlEscape(input.userName)}</UserName>`,
    `  <OwnerID>${xmlEscape(braceGuid(input.ownerId))}</OwnerID>`,
    `  <FileID>${xmlEscape(braceGuid(input.fileId))}</FileID>`,
    `  <QBType>QBFS</QBType>`,
    `  <Notify>false</Notify>`,
    ...scheduler,
    `</QBWCXML>`,
    ``,
  ].join("\n");
}
