import { Camera, FileUp, Wine } from "lucide-react";
import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/input";
import { PageTabs } from "../../components/ui/page-tabs";
import { Table, THead, Td, Th } from "../../components/ui/table";
import {
  emptyBottleCountsMismatch,
  emptyBottleSourceLabel,
  filterEmptyBottleEvents,
} from "../../lib/empty-bottle";
import { identifyEmptyBottlesFromPhoto } from "../../lib/empty-bottle-identify-api";
import { assertInvoiceImage } from "../../lib/invoice-image";
import { isManager } from "../../lib/schedule";
import type { EmptyBottleEventStatus, EmptyBottleEventWithRelations } from "../../lib/types";
import { fileToDataUrl, useRestaurants } from "../invoices/hooks";
import { EmptyBottleReviewDialog } from "./EmptyBottleReviewDialog";
import { useEmptyBottleCatalog, useEmptyBottleEvents } from "./hooks";

function statusTone(status: EmptyBottleEventStatus) {
  switch (status) {
    case "pending":
      return "warn" as const;
    case "confirmed":
      return "ok" as const;
    case "cancelled":
      return "neutral" as const;
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export function EmptyBottlesPage() {
  const { role } = useAuth();
  const { data: events = [], isLoading, error, refetch } = useEmptyBottleEvents();
  const { data: restaurants = [] } = useRestaurants();
  const { data: catalog = [] } = useEmptyBottleCatalog();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<EmptyBottleEventWithRelations | null>(null);
  const [restaurantFilter, setRestaurantFilter] = useState("");
  const [statusTab, setStatusTab] = useState<"all" | EmptyBottleEventStatus>("all");

  if (!isManager(role)) {
    return <Navigate to="/schedule" replace />;
  }

  const ingest = async (file: File) => {
    setBusy(true);
    setMessage("Identifying empty bottles…");
    try {
      assertInvoiceImage(file);
      const { data } = await fileToDataUrl(file);
      const result = await identifyEmptyBottlesFromPhoto({
        image: data,
        restaurantId: restaurantFilter || null,
      });
      await refetch();
      setMessage(
        `${result.proposed_label} identified${
          emptyBottleCountsMismatch(result.vision_count, result.gemini_count)
            ? " · Vision and Gemini counts differ"
            : ""
        }. Review before debiting.`,
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not identify bottles");
    } finally {
      setBusy(false);
    }
  };

  const visible = filterEmptyBottleEvents(events, restaurantFilter, statusTab);

  return (
    <div>
      <p className="mb-4 max-w-2xl text-sm text-muted">
        Photograph a lineup of empty bottles. Vision counts the boxes, Gemini names each bottle,
        then Confirm writes one usage movement per line.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2 md:flex-nowrap">
        <label className="inline-flex">
          <input
            className="hidden"
            type="file"
            accept="image/*"
            capture="environment"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void ingest(file);
              e.target.value = "";
            }}
          />
          <Button
            variant="outline"
            disabled={busy}
            onClick={(e) => (e.currentTarget.previousSibling as HTMLInputElement)?.click()}
          >
            <Camera className="size-4" />
            Camera
          </Button>
        </label>
        <label className="inline-flex">
          <input
            className="hidden"
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void ingest(file);
              e.target.value = "";
            }}
          />
          <Button
            variant="outline"
            disabled={busy}
            onClick={(e) => (e.currentTarget.previousSibling as HTMLInputElement)?.click()}
          >
            <FileUp className="size-4" />
            Upload photo
          </Button>
        </label>
        <div className="ml-auto w-full shrink-0 sm:w-56">
          <Select value={restaurantFilter} onChange={(e) => setRestaurantFilter(e.target.value)}>
            <option value="">All restaurants</option>
            {restaurants.map((restaurant) => (
              <option key={restaurant.id} value={restaurant.id}>
                {restaurant.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="mb-4">
        <PageTabs
          items={[
            { id: "all", label: "All" },
            { id: "pending", label: "Pending" },
            { id: "confirmed", label: "Confirmed" },
            { id: "cancelled", label: "Cancelled" },
          ]}
          value={statusTab}
          onChange={setStatusTab}
        />
      </div>

      {busy || message ? <p className="mb-3 text-sm text-muted">{message}</p> : null}
      {error ? <p className="text-sm text-danger">{error.message}</p> : null}
      {isLoading ? <p className="text-sm text-muted">Loading empty bottles…</p> : null}

      {!isLoading ? (
        <Table>
          <THead>
            <tr>
              <Th>Photo</Th>
              <Th>Bottles</Th>
              <Th>Restaurant</Th>
              <Th>Source</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </THead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <Td colSpan={6} className="py-10 text-center text-muted">
                  No empty-bottle captures yet. Photograph a lineup or send one from Telegram.
                </Td>
              </tr>
            ) : (
              visible.map((event) => (
                <tr key={event.id} className="hover:bg-paper">
                  <Td>
                    <div className="flex size-10 items-center justify-center rounded-lg bg-paper text-wine">
                      <Wine className="size-5" aria-hidden />
                    </div>
                  </Td>
                  <Td>
                    <div className="font-medium">{event.proposed_label}</div>
                    <div className="text-xs text-muted">
                      {event.empty_bottle_lines
                        .slice(0, 3)
                        .map((line) => line.proposed_label)
                        .join(", ") || "—"}
                    </div>
                  </Td>
                  <Td>{event.restaurants?.name ?? "—"}</Td>
                  <Td>{emptyBottleSourceLabel(event.source)}</Td>
                  <Td>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={statusTone(event.status)} dot>
                        {event.status}
                      </Badge>
                      {emptyBottleCountsMismatch(event.vision_count, event.gemini_count) ? (
                        <Badge tone="warn">Mismatch</Badge>
                      ) : null}
                    </div>
                  </Td>
                  <Td>
                    <div className="flex justify-end">
                      <Button variant="subtle" onClick={() => setReviewing(event)}>
                        Review
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      ) : null}

      <EmptyBottleReviewDialog
        open={Boolean(reviewing)}
        onOpenChange={(next) => {
          if (!next) setReviewing(null);
        }}
        event={reviewing}
        restaurants={restaurants}
        catalog={catalog}
      />
    </div>
  );
}
