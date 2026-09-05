import { useEffect, useState, type FormEvent } from "react";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Input, Select } from "../../components/ui/input";
import { Field } from "../../components/ui/label";
import { ITEM_CATEGORIES, ITEM_UNITS } from "../../lib/constants";
import type { InventoryItem } from "../../lib/types";
import { useSuppliers } from "../suppliers/hooks";
import { useUpsertItem, type ItemInput } from "./hooks";

const empty: ItemInput = {
  name: "",
  sku: "",
  category: "Produce",
  unit: "lb",
  quantity: 0,
  reorder_level: 0,
  unit_cost: 0,
  supplier_id: null,
};

export function ItemDialog({
  open,
  onOpenChange,
  item,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: InventoryItem | null;
}) {
  const { data: suppliers = [] } = useSuppliers();
  const upsert = useUpsertItem();
  const [values, setValues] = useState<ItemInput>(empty);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (item) {
      setValues({
        name: item.name,
        sku: item.sku ?? "",
        category: item.category ?? "Other",
        unit: item.unit,
        quantity: Number(item.quantity),
        reorder_level: Number(item.reorder_level),
        unit_cost: Number(item.unit_cost),
        supplier_id: item.supplier_id,
      });
    } else {
      setValues(empty);
    }
    setError(null);
  }, [open, item]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await upsert.mutateAsync({ id: item?.id, values });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save item");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={item ? "Edit item" : "Add inventory item"}
      description={item ? "Quantity is changed via stock adjustments." : "Starting quantity can be set here."}
    >
      <form id="item-form" className="grid grid-cols-2 gap-3" onSubmit={(e) => void onSubmit(e)}>
        <div className="col-span-2">
          <Field label="Name" htmlFor="item-name">
            <Input
              id="item-name"
              required
              value={values.name}
              onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
            />
          </Field>
        </div>
        <Field label="SKU" htmlFor="item-sku">
          <Input
            id="item-sku"
            value={values.sku}
            onChange={(e) => setValues((v) => ({ ...v, sku: e.target.value }))}
          />
        </Field>
        <Field label="Category" htmlFor="item-category">
          <Select
            id="item-category"
            value={values.category}
            onChange={(e) => setValues((v) => ({ ...v, category: e.target.value }))}
          >
            {ITEM_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Unit" htmlFor="item-unit">
          <Select
            id="item-unit"
            value={values.unit}
            onChange={(e) => setValues((v) => ({ ...v, unit: e.target.value }))}
          >
            {ITEM_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Unit cost (USD)" htmlFor="item-cost">
          <Input
            id="item-cost"
            type="number"
            min={0}
            step="0.01"
            value={values.unit_cost}
            onChange={(e) => setValues((v) => ({ ...v, unit_cost: Number(e.target.value) }))}
          />
        </Field>
        {!item ? (
          <Field label="Starting quantity" htmlFor="item-qty">
            <Input
              id="item-qty"
              type="number"
              min={0}
              step="0.01"
              value={values.quantity}
              onChange={(e) => setValues((v) => ({ ...v, quantity: Number(e.target.value) }))}
            />
          </Field>
        ) : (
          <Field label="On hand" htmlFor="item-qty-ro">
            <Input id="item-qty-ro" value={values.quantity} disabled />
          </Field>
        )}
        <Field label="Reorder level" htmlFor="item-reorder">
          <Input
            id="item-reorder"
            type="number"
            min={0}
            step="0.01"
            value={values.reorder_level}
            onChange={(e) => setValues((v) => ({ ...v, reorder_level: Number(e.target.value) }))}
          />
        </Field>
        <Field label="Supplier" htmlFor="item-supplier">
          <Select
            id="item-supplier"
            value={values.supplier_id ?? ""}
            onChange={(e) =>
              setValues((v) => ({ ...v, supplier_id: e.target.value || null }))
            }
          >
            <option value="">None</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      </form>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" form="item-form" disabled={upsert.isPending}>
          {upsert.isPending ? "Saving…" : "Save item"}
        </Button>
      </div>
    </Dialog>
  );
}
