import { useEffect, useState, type FormEvent } from "react";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Input, Select, Textarea } from "../../components/ui/input";
import { Field } from "../../components/ui/label";
import { MOVEMENT_REASONS } from "../../lib/constants";
import { formatQty } from "../../lib/format";
import { applyMovement, deltaForReason, reasonLabel } from "../../lib/inventory";
import type { InventoryItem, MovementReason } from "../../lib/types";
import { useAdjustStock } from "./hooks";

export function AdjustStockDialog({
  open,
  onOpenChange,
  item,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: InventoryItem | null;
}) {
  const adjust = useAdjustStock();
  const [reason, setReason] = useState<MovementReason>("purchase");
  const [amount, setAmount] = useState(1);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setReason("purchase");
    setAmount(1);
    setNote("");
    setError(null);
  }, [open, item]);

  if (!item) return null;

  const delta = deltaForReason(reason, amount);
  const nextQty = applyMovement(item.quantity, delta);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await adjust.mutateAsync({ item, delta, reason, note });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not adjust stock");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Adjust ${item.name}`}
      description={`On hand: ${formatQty(item.quantity)} ${item.unit}`}
    >
      <form id="adjust-form" className="grid gap-3" onSubmit={(e) => void onSubmit(e)}>
        <Field label="Reason" htmlFor="adj-reason">
          <Select
            id="adj-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value as MovementReason)}
          >
            {MOVEMENT_REASONS.map((r) => (
              <option key={r} value={r}>
                {reasonLabel(r)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={reason === "adjustment" ? "Signed delta" : "Amount"}
          htmlFor="adj-amount"
        >
          <Input
            id="adj-amount"
            type="number"
            step="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
        </Field>
        <Field label="Note" htmlFor="adj-note">
          <Textarea
            id="adj-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional"
          />
        </Field>
        <p className="text-sm text-mist">
          Resulting quantity:{" "}
          <span className="font-semibold text-navy">
            {formatQty(nextQty)} {item.unit}
          </span>
        </p>
      </form>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" form="adjust-form" disabled={adjust.isPending}>
          {adjust.isPending ? "Saving…" : "Record movement"}
        </Button>
      </div>
    </Dialog>
  );
}
