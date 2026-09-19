import { Download, KeyRound, Plug, ShieldOff } from "lucide-react";
import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import {
  createQbwcConnection,
  downloadBerrifyQwc,
  revokeQbwcConnection,
  rotateQbwcPassword,
} from "../../lib/qbwc-manager-api";
import { qbwcStatusLabel, qbwcUiStatus } from "../../lib/qbwc-status";
import { isManager } from "../../lib/schedule";
import type { QbwcUiStatus, QuickbooksDesktopConnection, Restaurant } from "../../lib/types";
import { useRestaurants } from "../invoices/hooks";
import { useQuickbooksConnections, useQuickbooksJobs } from "./hooks";

function statusTone(status: QbwcUiStatus) {
  switch (status) {
    case "not_configured":
      return "neutral" as const;
    case "waiting":
      return "warn" as const;
    case "connected":
      return "ok" as const;
    case "syncing":
      return "info" as const;
    case "error":
      return "danger" as const;
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

type CardTarget = {
  key: string;
  title: string;
  subtitle: string;
  restaurantId: string | null;
};

export function QuickbooksPage() {
  const { role } = useAuth();
  const { data: restaurants = [] } = useRestaurants();
  const { data: connections = [], isLoading, error, refetch } = useQuickbooksConnections();
  const { data: jobs = [], refetch: refetchJobs } = useQuickbooksJobs();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [oneTime, setOneTime] = useState<{ connectionId: string; username: string; password: string } | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);

  const targets: CardTarget[] = useMemo(() => {
    const shared: CardTarget = {
      key: "shared",
      title: "Shared company file",
      subtitle: "One QuickBooks company file for the whole organization",
      restaurantId: null,
    };
    const perRestaurant = restaurants.map((restaurant: Restaurant) => ({
      key: restaurant.id,
      title: restaurant.name,
      subtitle: restaurant.qbo_company_name,
      restaurantId: restaurant.id,
    }));
    return [shared, ...perRestaurant];
  }, [restaurants]);

  if (!isManager(role)) {
    return <Navigate to="/schedule" replace />;
  }

  const connectionFor = (restaurantId: string | null) =>
    connections.find((row) => (row.restaurant_id ?? null) === restaurantId) ?? null;

  const refresh = async () => {
    await Promise.all([refetch(), refetchJobs()]);
  };

  const connect = async (target: CardTarget) => {
    setBusyKey(target.key);
    setMessage(null);
    try {
      const result = await createQbwcConnection({
        restaurant_id: target.restaurantId,
        name: target.title,
      });
      setOneTime({
        connectionId: result.connection.id,
        username: result.connection.qb_username,
        password: result.password,
      });
      await refresh();
      setMessage("Connection created. Copy the password now — Berrify will not show it again.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not create connection");
    } finally {
      setBusyKey(null);
    }
  };

  const rotate = async (connection: QuickbooksDesktopConnection) => {
    setBusyKey(connection.id);
    setMessage(null);
    try {
      const password = await rotateQbwcPassword(connection.id);
      setOneTime({ connectionId: connection.id, username: connection.qb_username, password });
      await refresh();
      setMessage("Password regenerated. Update it in QuickBooks Web Connector.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not regenerate password");
    } finally {
      setBusyKey(null);
    }
  };

  const revoke = async (connection: QuickbooksDesktopConnection) => {
    setBusyKey(connection.id);
    setMessage(null);
    try {
      await revokeQbwcConnection(connection.id);
      if (oneTime?.connectionId === connection.id) setOneTime(null);
      await refresh();
      setMessage("Web Connector access revoked.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not revoke connection");
    } finally {
      setBusyKey(null);
    }
  };

  const download = async (connection: QuickbooksDesktopConnection) => {
    setBusyKey(connection.id);
    setMessage(null);
    try {
      await downloadBerrifyQwc(connection.id);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not download Berrify.qwc");
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted">
        QuickBooks Web Connector pulls from Berrify. First sync is a read-only company query — this page does
        not post Bills. Invoice IIF export is unchanged. Windows Web Connector steps are in{" "}
        <span className="font-mono">docs/qbwc-desktop.md</span>.
      </p>

      {oneTime ? (
        <Card className="border-wine/30 bg-wine/5">
          <p className="text-sm font-semibold text-ink">One-time Web Connector password</p>
          <p className="mt-1 text-sm text-muted">
            Username <span className="font-mono text-ink">{oneTime.username}</span>
          </p>
          <p className="mt-2 break-all font-mono text-sm text-ink">{oneTime.password}</p>
          <p className="mt-2 text-xs text-muted">Paste this into QBWC once. Berrify stores only a hash.</p>
        </Card>
      ) : null}

      {message ? <p className="text-sm text-ink">{message}</p> : null}
      {error ? <p className="text-sm text-danger">Could not load QuickBooks connections.</p> : null}
      {isLoading ? <p className="text-sm text-muted">Loading connections…</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {targets.map((target) => {
          const connection = connectionFor(target.restaurantId);
          const status = qbwcUiStatus(
            connection,
            jobs.filter((job) => job.connection_id === connection?.id),
          );
          const busy = busyKey === target.key || busyKey === connection?.id;
          return (
            <Card key={target.key}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-ink">{target.title}</h2>
                  <p className="mt-0.5 text-sm text-muted">{target.subtitle}</p>
                </div>
                <Badge tone={statusTone(status)} dot>
                  {qbwcStatusLabel(status)}
                </Badge>
              </div>

              {connection?.qb_company_name ? (
                <p className="mt-3 text-sm text-ink">
                  QuickBooks company: {connection.qb_company_name}
                  {connection.qb_product_name
                    ? ` · ${connection.qb_product_name} ${connection.qb_major_version ?? ""}`
                    : ""}
                </p>
              ) : null}
              {connection?.last_error ? (
                <p className="mt-2 text-sm text-danger">{connection.last_error}</p>
              ) : null}
              {connection ? (
                <p className="mt-2 text-xs text-muted">
                  Username <span className="font-mono">{connection.qb_username}</span>
                </p>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                {!connection || !connection.is_active ? (
                  <Button onClick={() => void connect(target)} disabled={busy}>
                    <Plug className="size-4" />
                    Connect QuickBooks Desktop
                  </Button>
                ) : (
                  <>
                    <Button onClick={() => void download(connection)} disabled={busy}>
                      <Download className="size-4" />
                      Download Berrify.qwc
                    </Button>
                    <Button variant="outline" onClick={() => void rotate(connection)} disabled={busy}>
                      <KeyRound className="size-4" />
                      Regenerate password
                    </Button>
                    <Button variant="danger" onClick={() => void revoke(connection)} disabled={busy}>
                      <ShieldOff className="size-4" />
                      Revoke
                    </Button>
                  </>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
