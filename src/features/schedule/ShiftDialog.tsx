import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Input, Select, Textarea } from "../../components/ui/input";
import { Field } from "../../components/ui/label";
import { STATIONS } from "../../lib/constants";
import { employeeHasOverlap } from "../../lib/schedule";
import type { Employee, Shift, ShiftStatus, Station } from "../../lib/types";
import { fromDatetimeLocal, toDatetimeLocal, useDeleteShift, useUpsertShift } from "./hooks";

type Draft = {
  employee_id: string;
  position: Station;
  starts_at: string;
  ends_at: string;
  status: ShiftStatus;
  note: string;
};

export function ShiftDialog({
  open,
  onOpenChange,
  shift,
  employees,
  existing,
  defaultStarts,
  defaultEnds,
  defaultEmployeeId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shift: Shift | null;
  employees: Employee[];
  existing: Shift[];
  defaultStarts?: string;
  defaultEnds?: string;
  defaultEmployeeId?: string | null;
}) {
  const upsert = useUpsertShift();
  const remove = useDeleteShift();
  const [values, setValues] = useState<Draft>({
    employee_id: "",
    position: "Server",
    starts_at: "",
    ends_at: "",
    status: "draft",
    note: "",
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (shift) {
      setValues({
        employee_id: shift.employee_id ?? "",
        position: shift.position,
        starts_at: toDatetimeLocal(shift.starts_at),
        ends_at: toDatetimeLocal(shift.ends_at),
        status: shift.status,
        note: shift.note ?? "",
      });
    } else {
      const emp = employees.find((e) => e.id === defaultEmployeeId);
      setValues({
        employee_id: defaultEmployeeId ?? "",
        position: emp?.position ?? "Server",
        starts_at: defaultStarts ? toDatetimeLocal(defaultStarts) : "",
        ends_at: defaultEnds ? toDatetimeLocal(defaultEnds) : "",
        status: "draft",
        note: "",
      });
    }
    setError(null);
  }, [open, shift, defaultStarts, defaultEnds, defaultEmployeeId, employees]);

  const overlap = useMemo(() => {
    if (!values.starts_at || !values.ends_at) return false;
    return employeeHasOverlap(existing, {
      id: shift?.id ?? "",
      employee_id: values.employee_id || null,
      starts_at: fromDatetimeLocal(values.starts_at),
      ends_at: fromDatetimeLocal(values.ends_at),
    });
  }, [existing, shift, values]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await upsert.mutateAsync({
        id: shift?.id,
        values: {
          employee_id: values.employee_id || null,
          position: values.position,
          starts_at: fromDatetimeLocal(values.starts_at),
          ends_at: fromDatetimeLocal(values.ends_at),
          status: values.status,
          note: values.note,
        },
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save shift");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={shift ? "Edit shift" : "Add shift"}
      description="Drafts stay hidden from staff until you publish."
    >
      <form id="shift-form" className="grid grid-cols-2 gap-3" onSubmit={(e) => void onSubmit(e)}>
        <div className="col-span-2">
          <Field label="Employee" htmlFor="shift-emp">
            <Select
              id="shift-emp"
              value={values.employee_id}
              onChange={(e) => {
                const id = e.target.value;
                const emp = employees.find((row) => row.id === id);
                setValues((v) => ({
                  ...v,
                  employee_id: id,
                  position: emp?.position ?? v.position,
                }));
              }}
            >
              <option value="">Open / unassigned</option>
              {employees
                .filter((e) => e.active)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name} · {e.position}
                  </option>
                ))}
            </Select>
          </Field>
        </div>
        <Field label="Station" htmlFor="shift-station">
          <Select
            id="shift-station"
            value={values.position}
            onChange={(e) => setValues((v) => ({ ...v, position: e.target.value as Station }))}
          >
            {STATIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" htmlFor="shift-status">
          <Select
            id="shift-status"
            value={values.status}
            onChange={(e) => setValues((v) => ({ ...v, status: e.target.value as ShiftStatus }))}
          >
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </Select>
        </Field>
        <Field label="Starts" htmlFor="shift-start">
          <Input
            id="shift-start"
            type="datetime-local"
            required
            value={values.starts_at}
            onChange={(e) => setValues((v) => ({ ...v, starts_at: e.target.value }))}
          />
        </Field>
        <Field label="Ends" htmlFor="shift-end">
          <Input
            id="shift-end"
            type="datetime-local"
            required
            value={values.ends_at}
            onChange={(e) => setValues((v) => ({ ...v, ends_at: e.target.value }))}
          />
        </Field>
        <div className="col-span-2">
          <Field label="Note" htmlFor="shift-note">
            <Textarea
              id="shift-note"
              value={values.note}
              onChange={(e) => setValues((v) => ({ ...v, note: e.target.value }))}
            />
          </Field>
        </div>
      </form>
      {overlap ? (
        <p className="mt-3 text-sm text-warn">This employee already has an overlapping shift.</p>
      ) : null}
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      <div className="mt-5 flex justify-end gap-2">
        {shift ? (
          <Button
            variant="danger"
            className="mr-auto"
            onClick={() => {
              if (window.confirm("Delete this shift?")) {
                void remove.mutateAsync(shift.id).then(() => onOpenChange(false));
              }
            }}
          >
            Delete
          </Button>
        ) : null}
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" form="shift-form" disabled={upsert.isPending}>
          {upsert.isPending ? "Saving…" : "Save shift"}
        </Button>
      </div>
    </Dialog>
  );
}
