import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Input, Select } from "../../components/ui/input";
import { Field } from "../../components/ui/label";
import { Table, THead, Td, Th } from "../../components/ui/table";
import { emptyBottleCountsMismatch } from "../../lib/empty-bottle";
import type { EmptyBottleEventWithRelations, InventoryItem, Restaurant } from "../../lib/types";
import {
  useCancelEmptyBottle,
  useConfirmEmptyBottle,
  useEmptyBottleMedia,
  useSaveEmptyBottleReview,
} from "./hooks";

type DraftLine = {
  key: string;
  id?: string;
  proposed_item_id: string | null;
  proposed_label: string;
  qty: number;
};

function toDraft(event: EmptyBottleEventWithRelations): DraftLine[] {
  if (event.empty_bottle_lines.length === 0 && event.proposed_item_id) {
    return [
      {
        key: "legacy",
        proposed_item_id: event.proposed_item_id,
        proposed_label: event.proposed_label,
        qty: 1,
      },
    ];
  }
  return event.empty_bottle_lines.map((line) => ({
    key: line.id,
    id: line.id,
    proposed_item_id: line.proposed_item_id,
    proposed_label: line.proposed_label,
    qty: Number(line.qty),
  }));
}

export function EmptyBottleReviewDialog({
  open,
  onOpenChange,
  event,
  restaurants,
  catalog,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: EmptyBottleEventWithRelations | null;
  restaurants: Restaurant[];
  catalog: Array<Pick<InventoryItem, "id" | "name" | "sku">>;
}) {
  const media = useEmptyBottleMedia(open ? event?.id ?? null : null);
  const save = useSaveEmptyBottleReview();
  const confirm = useConfirmEmptyBottle();
  const cancel = useCancelEmptyBottle();
  const [restaurantId, setRestaurantId] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!event) return;
    setRestaurantId(event.restaurant_id ?? "");
    setLines(toDraft(event));
    setMessage(null);
  }, [event]);

  if (!event) return null;
  const pending = event.status === "pending";
  const mismatch = emptyBottleCountsMismatch(event.vision_count, event.gemini_count);
  const photo = media.data?.image_data;

  const persist = async () => {
    await save.mutateAsync({
      eventId: event.id,
      restaurantId: restaurantId || null,
      lines: lines.map((line) => ({
        id: line.id,
        proposed_item_id: line.proposed_item_id,
        proposed_label: line.proposed_label.trim() || "Unknown liquor",
        qty: line.qty >= 1 ? line.qty : 1,
      })),
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Review empty bottles"
      description={event.proposed_label}
      className="w-[min(820px,calc(100vw-1.5rem))]"
      footer={
        pending ? (
          <>
            <Button
              variant="outline"
              disabled={cancel.isPending || save.isPending || confirm.isPending}
              onClick={() => {
                void cancel.mutateAsync(event.id).then(
                  () => onOpenChange(false),
                  (err: unknown) => setMessage(err instanceof Error ? err.message : "Could not cancel"),
                );
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={confirm.isPending || save.isPending || lines.length === 0}
              onClick={() => {
                void persist()
                  .then(() => confirm.mutateAsync(event.id))
                  .then(
                    () => onOpenChange(false),
                    (err: unknown) => setMessage(err instanceof Error ? err.message : "Could not confirm"),
                  );
              }}
            >
              Confirm debit
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="overflow-hidden rounded-xl border border-line bg-paper">
          {photo ? (
            <img src={photo} alt="Empty bottles" className="max-h-80 w-full object-contain" />
          ) : (
            <p className="p-6 text-sm text-muted">{media.isLoading ? "Loading photo…" : "No photo stored."}</p>
          )}
        </div>
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Vision counted {event.vision_count ?? "—"}. Gemini counted {event.gemini_count ?? "—"}.
            {mismatch ? " Counts do not match — add any missing bottles." : ""}
          </p>
          <Field label="Restaurant">
            <Select
              value={restaurantId}
              disabled={!pending}
              onChange={(e) => setRestaurantId(e.target.value)}
            >
              <option value="">Org / none</option>
              {restaurants.map((restaurant) => (
                <option key={restaurant.id} value={restaurant.id}>
                  {restaurant.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>

      <div className="mt-4">
        <Table>
          <THead>
            <tr>
              <Th>Item</Th>
              <Th>Label</Th>
              <Th>Qty</Th>
              <Th />
            </tr>
          </THead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={line.key}>
                <Td>
                  <Select
                    aria-label={`Item ${index + 1}`}
                    value={line.proposed_item_id ?? ""}
                    disabled={!pending}
                    onChange={(e) => {
                      const itemId = e.target.value || null;
                      const item = catalog.find((row) => row.id === itemId);
                      setLines((current) =>
                        current.map((row) =>
                          row.key === line.key
                            ? {
                                ...row,
                                proposed_item_id: itemId,
                                proposed_label: row.proposed_label || item?.name || "",
                              }
                            : row,
                        ),
                      );
                    }}
                  >
                    <option value="">Select item</option>
                    {catalog.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </Select>
                </Td>
                <Td>
                  <Input
                    aria-label={`Label ${index + 1}`}
                    value={line.proposed_label}
                    disabled={!pending}
                    onChange={(e) =>
                      setLines((current) =>
                        current.map((row) =>
                          row.key === line.key ? { ...row, proposed_label: e.target.value } : row,
                        ),
                      )
                    }
                  />
                </Td>
                <Td>
                  <Input
                    aria-label={`Qty ${index + 1}`}
                    type="number"
                    min={1}
                    value={line.qty}
                    disabled={!pending}
                    onChange={(e) =>
                      setLines((current) =>
                        current.map((row) =>
                          row.key === line.key ? { ...row, qty: Number(e.target.value) || 1 } : row,
                        ),
                      )
                    }
                  />
                </Td>
                <Td>
                  {pending ? (
                    <Button
                      variant="subtle"
                      onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))}
                    >
                      Remove
                    </Button>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {pending ? (
          <Button
            className="mt-2"
            variant="outline"
            onClick={() =>
              setLines((current) => [
                ...current,
                {
                  key: `new-${current.length}-${Date.now()}`,
                  proposed_item_id: catalog[0]?.id ?? null,
                  proposed_label: catalog[0]?.name ?? "",
                  qty: 1,
                },
              ])
            }
          >
            Add line
          </Button>
        ) : null}
      </div>
      {message ? <p className="mt-3 text-sm text-danger">{message}</p> : null}
    </Dialog>
  );
}
