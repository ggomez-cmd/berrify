import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Input, Select, Textarea } from "../../components/ui/input";
import { Field } from "../../components/ui/label";
import { STATIONS } from "../../lib/constants";
import {
  composeShiftRangeOnDay,
  employeeHasOverlap,
  formatLockedShiftDay,
  localDayFromYmd,
} from "../../lib/schedule";
import type { Employee, Shift, ShiftStatus, Station } from "../../lib/types";
import { toDatetimeLocal, useDeleteShift, useUpsertShift } from "./hooks";

type Draft = {
  employee_id: string;
  position: Station;
  day: string;
  start_time: string;
  end_time: string;
  status: ShiftStatus;
  note: string;
};

function clockFromDatetimeLocal(value: string): string {
  const time = value.split("T")[1];
  return time ? time.slice(0, 5) : "";
}

function ymdFromDatetimeLocal(value: string): string {
  return value.slice(0, 10);
}

function composeDraftRange(values: Draft): { starts_at: string; ends_at: string } | null {
  if (!values.day || !values.start_time || !values.end_time) return null;
  return composeShiftRangeOnDay(localDayFromYmd(values.day), values.start_time, values.end_time);
}

export function ShiftDialog({
  open,
  onOpenChange,
  shift,
  employees,
  existing,
  defaultStarts,
  defaultEnds,
  defaultEmployeeId,
  lockDay = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shift: Shift | null;
  employees: Employee[];
  existing: Shift[];
  defaultStarts?: string;
  defaultEnds?: string;
  defaultEmployeeId?: string | null;
  lockDay?: boolean;
}) {
  const upsert = useUpsertShift();
  const remove = useDeleteShift();
  const [values, setValues] = useState<Draft>({
    employee_id: "",
    position: "Server",
    day: "",
    start_time: "",
    end_time: "",
    status: "draft",
    note: "",
  });
  const [error, setError] = useState<string | null>(null);
  const dateLocked = Boolean(shift) || lockDay;
  const employeeLocked = !shift && lockDay;

  useEffect(() => {
    if (!open) return;
    if (shift) {
      const starts = toDatetimeLocal(shift.starts_at);
      const ends = toDatetimeLocal(shift.ends_at);
      setValues({
        employee_id: shift.employee_id ?? "",
        position: shift.position,
        day: ymdFromDatetimeLocal(starts),
        start_time: clockFromDatetimeLocal(starts),
        end_time: clockFromDatetimeLocal(ends),
        status: shift.status,
        note: shift.note ?? "",
      });
    } else {
      const emp = employees.find((e) => e.id === defaultEmployeeId);
      const starts = defaultStarts ? toDatetimeLocal(defaultStarts) : "";
      const ends = defaultEnds ? toDatetimeLocal(defaultEnds) : "";
      setValues({
        employee_id: defaultEmployeeId ?? "",
        position: emp?.position ?? "Server",
        day: starts ? ymdFromDatetimeLocal(starts) : "",
        start_time: starts ? clockFromDatetimeLocal(starts) : "",
        end_time: ends ? clockFromDatetimeLocal(ends) : "",
        status: "draft",
        note: "",
      });
    }
    setError(null);
  }, [open, shift, defaultStarts, defaultEnds, defaultEmployeeId, employees]);

  const overlap = useMemo(() => {
    const range = composeDraftRange(values);
    if (!range) return false;
    return employeeHasOverlap(existing, {
      id: shift?.id ?? "",
      employee_id: values.employee_id || null,
      starts_at: range.starts_at,
      ends_at: range.ends_at,
    });
  }, [existing, shift, values]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const range = composeDraftRange(values);
    if (!range) {
      setError("Start and end times are required");
      return;
    }
    try {
      await upsert.mutateAsync({
        id: shift?.id,
        values: {
          employee_id: values.employee_id || null,
          position: values.position,
          starts_at: range.starts_at,
          ends_at: range.ends_at,
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
              disabled={employeeLocked}
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
        {dateLocked ? (
          <div className="col-span-2">
            <Field label="Date">
              <p className="rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink">
                {values.day ? formatLockedShiftDay(localDayFromYmd(values.day)) : ""}
              </p>
            </Field>
          </div>
        ) : (
          <div className="col-span-2">
            <Field label="Date" htmlFor="shift-day">
              <Input
                id="shift-day"
                type="date"
                required
                value={values.day}
                onChange={(e) => setValues((v) => ({ ...v, day: e.target.value }))}
              />
            </Field>
          </div>
        )}
        <Field label="Starts" htmlFor="shift-start">
          <Input
            id="shift-start"
            type="time"
            required
            value={values.start_time}
            onChange={(e) => setValues((v) => ({ ...v, start_time: e.target.value }))}
          />
        </Field>
        <Field label="Ends" htmlFor="shift-end">
          <Input
            id="shift-end"
            type="time"
            required
            value={values.end_time}
            onChange={(e) => setValues((v) => ({ ...v, end_time: e.target.value }))}
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
