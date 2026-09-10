import { useEffect, useState, type FormEvent } from "react";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Input, Select } from "../../components/ui/input";
import { Field } from "../../components/ui/label";
import { STATIONS } from "../../lib/constants";
import { isValidClockPin } from "../../lib/pin";
import type { Employee, LoginRole, Station } from "../../lib/types";
import { useSetClockPin, useUpsertEmployee, type EmployeeInput } from "./hooks";

const empty: EmployeeInput = {
  full_name: "",
  email: "",
  phone: "",
  position: "Server",
  login_role: "staff",
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
  const setPin = useSetClockPin();
  const [values, setValues] = useState<EmployeeInput>(empty);
  const [clockPin, setClockPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (employee) {
      setValues({
        full_name: employee.full_name,
        email: employee.email ?? "",
        phone: employee.phone ?? "",
        position: employee.position,
        login_role: employee.login_role === "manager" ? "manager" : "staff",
        hourly_rate: Number(employee.hourly_rate),
        active: employee.active,
      });
    } else {
      setValues(empty);
    }
    setClockPin("");
    setError(null);
  }, [open, employee]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      if (clockPin && !isValidClockPin(clockPin)) {
        throw new Error("Clock PIN must be 4 to 8 digits");
      }
      const savedId = await upsert.mutateAsync({ id: employee?.id, values });
      if (clockPin) {
        await setPin.mutateAsync({ id: savedId, pin: clockPin });
      }
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save account");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={employee ? "Edit account" : "Create account"}
      description="Admins set station, pay, and whether this person is a manager or staff. They sign up with this email and the invite code."
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
        <Field label="App access" htmlFor="emp-login-role">
          <Select
            id="emp-login-role"
            value={values.login_role}
            onChange={(e) => setValues((v) => ({ ...v, login_role: e.target.value as LoginRole }))}
          >
            <option value="staff">Staff</option>
            <option value="manager">Manager</option>
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
        <Field label="Clock PIN" htmlFor="emp-pin">
          <Input
            id="emp-pin"
            inputMode="numeric"
            autoComplete="off"
            placeholder={employee ? "Leave blank to keep" : "4–8 digits"}
            value={clockPin}
            onChange={(e) => setClockPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
          />
        </Field>
        {employee && !employee.user_id && employee.invite_code ? (
          <div className="col-span-2">
            <Field label="Invite code" htmlFor="emp-invite">
              <Input id="emp-invite" readOnly value={employee.invite_code} />
            </Field>
          </div>
        ) : null}
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
        <Button type="submit" form="employee-form" disabled={upsert.isPending || setPin.isPending}>
          {upsert.isPending || setPin.isPending ? "Saving…" : "Save account"}
        </Button>
      </div>
    </Dialog>
  );
}
