import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../auth/auth-context";
import { isManager } from "../../lib/schedule";
import { supabase } from "../../lib/supabase";
import type { QuickbooksDesktopConnection, QuickbooksSyncJob } from "../../lib/types";

const CONNECTION_SELECT =
  "id, org_id, restaurant_id, name, qb_username, owner_id, file_id, company_file, qb_company_name, qb_product_name, qb_major_version, qb_minor_version, is_active, last_connected_at, last_successful_sync_at, last_error, created_at, updated_at";

export function useQuickbooksConnections() {
  const { org, role } = useAuth();
  return useQuery({
    queryKey: ["quickbooks_desktop_connections", org?.id],
    enabled: Boolean(org?.id) && isManager(role),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quickbooks_desktop_connections")
        .select(CONNECTION_SELECT)
        .eq("org_id", org!.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as QuickbooksDesktopConnection[];
    },
  });
}

export function useQuickbooksJobs() {
  const { org, role } = useAuth();
  return useQuery({
    queryKey: ["quickbooks_sync_jobs", org?.id],
    enabled: Boolean(org?.id) && isManager(role),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quickbooks_sync_jobs")
        .select(
          "id, org_id, connection_id, status, operation, entity_type, entity_id, attempt_count, error_code, error_message, created_at, updated_at",
        )
        .eq("org_id", org!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as QuickbooksSyncJob[];
    },
  });
}
