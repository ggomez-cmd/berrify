import { useEffect, useState, type FormEvent } from "react";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Input, Textarea } from "../../components/ui/input";
import { Field } from "../../components/ui/label";
import type { Supplier } from "../../lib/types";
import { useUpsertSupplier, type SupplierInput } from "./hooks";

const empty: SupplierInput = { name: "", contact_email: "", phone: "", notes: "" };

export function SupplierDialog({
  open,
  onOpenChange,
  supplier,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplier: Supplier | null;
}) {
  const upsert = useUpsertSupplier();
  const [values, setValues] = useState<SupplierInput>(empty);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (supplier) {
      setValues({
        name: supplier.name,
        contact_email: supplier.contact_email ?? "",
        phone: supplier.phone ?? "",
        notes: supplier.notes ?? "",
      });
    } else {
      setValues(empty);
    }
    setError(null);
  }, [open, supplier]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await upsert.mutateAsync({ id: supplier?.id, values });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save supplier");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={supplier ? "Edit supplier" : "Add supplier"}
    >
      <form id="supplier-form" className="grid gap-3" onSubmit={(e) => void onSubmit(e)}>
        <Field label="Name" htmlFor="sup-name">
          <Input
            id="sup-name"
            required
            value={values.name}
            onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
          />
        </Field>
        <Field label="Email" htmlFor="sup-email">
          <Input
            id="sup-email"
            type="email"
            value={values.contact_email}
            onChange={(e) => setValues((v) => ({ ...v, contact_email: e.target.value }))}
          />
        </Field>
        <Field label="Phone" htmlFor="sup-phone">
          <Input
            id="sup-phone"
            value={values.phone}
            onChange={(e) => setValues((v) => ({ ...v, phone: e.target.value }))}
          />
        </Field>
        <Field label="Notes" htmlFor="sup-notes">
          <Textarea
            id="sup-notes"
            value={values.notes}
            onChange={(e) => setValues((v) => ({ ...v, notes: e.target.value }))}
          />
        </Field>
      </form>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" form="supplier-form" disabled={upsert.isPending}>
          {upsert.isPending ? "Saving…" : "Save supplier"}
        </Button>
      </div>
    </Dialog>
  );
}
