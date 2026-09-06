import { useEffect, useState, type FormEvent } from "react";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Input, Select } from "../../components/ui/input";
import { Field } from "../../components/ui/label";
import { STATIONS } from "../../lib/constants";
import type { Employee, Station } from "../../lib/types";
import { useUpsertEmployee, type EmployeeInput } from "./hooks";

const empty: EmployeeInput = {
  full_name: "",
  email: "",
  phone: "",
  position: "Server",
  hourly_rate: 0,
  active: true,
};

export function EmployeeDialog({
  open,
  onOpenChange,
  employee,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: Employee | null;
}) {
  const upsert = useUpsertEmployee();
  const [values, setValues] = useState<EmployeeInput>(empty);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (employee) {
      setValues({
        full_name: employee.full_name,
        email: employee.email ?? "",
        phone: employee.phone ?? "",
        position: employee.position,
        hourly_rate: Number(employee.hourly_rate),
        active: employee.active,
      });
    } else {
      setValues(empty);
    }
    setError(null);
  }, [open, employee]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await upsert.mutateAsync({ id: employee?.id, values });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save employee");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={employee ? "Edit employee" : "Add employee"}
      description="Matching email on signup joins this restaurant as staff."
    >
      <form id="employee-form" className="grid grid-cols-2 gap-3" onSubmit={(e) => void onSubmit(e)}>
        <div className="col-span-2">
          <Field label="Full name" htmlFor="emp-name">
            <Input
              id="emp-name"
              required
              value={values.full_name}
              onChange={(e) => setValues((v) => ({ ...v, full_name: e.target.value }))}
            />
          </Field>
        </div>
        <Field label="Email" htmlFor="emp-email">
          <Input
            id="emp-email"
            type="email"
            value={values.email}
            onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
          />
        </Field>
        <Field label="Phone" htmlFor="emp-phone">
          <Input
            id="emp-phone"
            value={values.phone}
            onChange={(e) => setValues((v) => ({ ...v, phone: e.target.value }))}
          />
        </Field>
        <Field label="Station" htmlFor="emp-position">
          <Select
            id="emp-position"
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
        <Field label="Hourly rate" htmlFor="emp-rate">
          <Input
            id="emp-rate"
            type="number"
            min={0}
            step="0.01"
            value={values.hourly_rate}
            onChange={(e) => setValues((v) => ({ ...v, hourly_rate: Number(e.target.value) }))}
          />
        </Field>
        <div className="col-span-2">
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={values.active}
              onChange={(e) => setValues((v) => ({ ...v, active: e.target.checked }))}
            />
            Active on the roster
          </label>
        </div>
      </form>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" form="employee-form" disabled={upsert.isPending}>
          {upsert.isPending ? "Saving…" : "Save employee"}
        </Button>
      </div>
    </Dialog>
  );
}
