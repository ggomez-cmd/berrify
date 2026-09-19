import type { QbwcUiStatus, QuickbooksDesktopConnection, QuickbooksSyncJob } from "./types";

export function qbwcUiStatus(
  connection: QuickbooksDesktopConnection | null | undefined,
  jobs: QuickbooksSyncJob[] = [],
): QbwcUiStatus {
  if (!connection || !connection.is_active) return "not_configured";
  const open = jobs.some((job) => job.status === "pending" || job.status === "sending");
  if (open) return "syncing";
  if (connection.last_error) return "error";
  if (connection.last_successful_sync_at || connection.qb_company_name) return "connected";
  return "waiting";
}

export function qbwcStatusLabel(status: QbwcUiStatus): string {
  switch (status) {
    case "not_configured":
      return "Not configured";
    case "waiting":
      return "Waiting for QuickBooks";
    case "connected":
      return "Connected";
    case "syncing":
      return "Syncing";
    case "error":
      return "Error";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}
