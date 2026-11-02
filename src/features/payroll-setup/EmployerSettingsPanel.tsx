import { useEffect, useState, type FormEvent } from "react";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Input, Select, Textarea } from "../../components/ui/input";
import { Field } from "../../components/ui/label";
import { Table, THead, Td, Th } from "../../components/ui/table";
import { basisPointsToPercentInput, percentToBasisPoints } from "../../lib/payroll/setup";
import type { DailyWindowMode } from "../../lib/payroll-engine/hours/types";
import type { PayFrequency } from "../../lib/payroll-engine/types";
import type { PayrollEmployerSettingsRow } from "../../lib/types";
import {
  useDeletePayrollEmployerSettings,
  usePayrollEmployerSettings,
  useUpsertPayrollEmployerSettings,
} from "./hooks";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const DEFAULT_MEAL_AFTER_MINUTES = "360";
const DEFAULT_MEAL_DEDUCT_MINUTES = "30";

type FormState = {
  effective_from: string;
  sut_percent: string;
  swh_method: PayrollEmployerSettingsRow["swh_method"];
  pay_frequency: PayFrequency;
  daily_ot_mode: DailyWindowMode;
  workweek_start_day: number;
  time_zone: string;
  punch_rounding: PayrollEmployerSettingsRow["punch_rounding"];
  hourly_pay_rounding: PayrollEmployerSettingsRow["hourly_pay_rounding"];
  auto_lunch: boolean;
  meal_deduct_after_minutes: string;
  meal_deduct_minutes: string;
  notes: string;
};

const empty: FormState = {
  effective_from: "",
  sut_percent: "2.70",
  swh_method: "annualized",
  pay_frequency: "biweekly",
  daily_ot_mode: "rolling_24h",
  workweek_start_day: 0,
  time_zone: "America/Puerto_Rico",
  punch_rounding: "none",
  hourly_pay_rounding: "per_line",
  auto_lunch: false,
  meal_deduct_after_minutes: DEFAULT_MEAL_AFTER_MINUTES,
  meal_deduct_minutes: DEFAULT_MEAL_DEDUCT_MINUTES,
  notes: "",
};

function dailyOtLabel(mode: DailyWindowMode): string {
  switch (mode) {
    case "rolling_24h":
      return "Rolling 24h";
    case "calendar_day":
      return "Calendar day";
    case "clock_in_day":
      return "Clock-in day";
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
}

function punchRoundingLabel(value: PayrollEmployerSettingsRow["punch_rounding"]): string {
  switch (value) {
    case "none":
      return "None";
    case "hundredth_hour":
      return "0.01 h";
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

function hourlyRoundingLabel(value: PayrollEmployerSettingsRow["hourly_pay_rounding"]): string {
  switch (value) {
    case "per_line":
      return "Per line";
    case "period":
      return "Once per period";
    default: {
      const exhaustive: never = value;
      return exhaustive;
    }
  }
}

function parsePositiveMinutes(raw: string): number | null {
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

export function EmployerSettingsPanel() {
  const { data: rows = [], isLoading, error } = usePayrollEmployerSettings();
  const remove = useDeletePayrollEmployerSettings();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PayrollEmployerSettingsRow | null>(null);

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          Add effective date
        </Button>
      </div>
      {error ? <p className="mb-3 text-sm text-danger">{error.message}</p> : null}
      {isLoading ? <p className="text-sm text-muted">Loading employer settings…</p> : null}
      {!isLoading ? (
        <Table>
          <THead>
            <tr>
              <Th>Effective</Th>
              <Th>SUT</Th>
              <Th>SWH method</Th>
              <Th>Pay frequency</Th>
              <Th>Daily OT</Th>
              <Th>Punch rounding</Th>
              <Th>Hourly rounding</Th>
              <Th>Auto lunch</Th>
              <Th>Workweek</Th>
              <Th>Time zone</Th>
              <Th />
            </tr>
          </THead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <Td colSpan={11} className="py-10 text-center text-muted">
                  No employer settings yet.
                </Td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <Td>{row.effective_from}</Td>
                  <Td>{basisPointsToPercentInput(row.sut_rate_bp)}%</Td>
                  <Td>{row.swh_method === "biweekly_table" ? "Biweekly table" : "Annualized"}</Td>
                  <Td>{row.pay_frequency === "weekly" ? "Weekly" : "Biweekly"}</Td>
                  <Td>{dailyOtLabel(row.daily_ot_mode)}</Td>
                  <Td>{punchRoundingLabel(row.punch_rounding)}</Td>
                  <Td>{hourlyRoundingLabel(row.hourly_pay_rounding)}</Td>
                  <Td>
                    {row.meal_deduct_after_minutes != null && row.meal_deduct_minutes != null
                      ? `${row.meal_deduct_after_minutes} / ${row.meal_deduct_minutes} min`
                      : "Off"}
                  </Td>
                  <Td>{WEEKDAYS[row.workweek_start_day] ?? row.workweek_start_day}</Td>
                  <Td>{row.time_zone}</Td>
                  <Td>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="subtle"
                        onClick={() => {
                          setEditing(row);
                          setOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="subtle"
                        onClick={() => {
                          if (window.confirm("Delete this employer settings row?")) {
                            void remove.mutateAsync(row.id);
                          }
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      ) : null}
      <EmployerSettingsDialog open={open} onOpenChange={setOpen} row={editing} />
    </div>
  );
}

function EmployerSettingsDialog({
  open,
  onOpenChange,
  row,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: PayrollEmployerSettingsRow | null;
}) {
  const upsert = useUpsertPayrollEmployerSettings();
  const [values, setValues] = useState<FormState>(empty);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (row) {
      const autoLunch = row.meal_deduct_after_minutes != null && row.meal_deduct_minutes != null;
      setValues({
        effective_from: row.effective_from,
        sut_percent: basisPointsToPercentInput(row.sut_rate_bp),
        swh_method: row.swh_method,
        pay_frequency: row.pay_frequency,
        daily_ot_mode: row.daily_ot_mode,
        workweek_start_day: row.workweek_start_day,
        time_zone: row.time_zone,
        punch_rounding: row.punch_rounding,
        hourly_pay_rounding: row.hourly_pay_rounding,
        auto_lunch: autoLunch,
        meal_deduct_after_minutes: autoLunch
          ? String(row.meal_deduct_after_minutes)
          : DEFAULT_MEAL_AFTER_MINUTES,
        meal_deduct_minutes: autoLunch ? String(row.meal_deduct_minutes) : DEFAULT_MEAL_DEDUCT_MINUTES,
        notes: row.notes ?? "",
      });
    } else {
      setValues(empty);
    }
    setFormError(null);
  }, [open, row]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const sutRateBp = percentToBasisPoints(values.sut_percent);
    if (sutRateBp === null) {
      setFormError("SUT rate must be a percent such as 2.70");
      return;
    }
    let mealAfter: number | null = null;
    let mealMinutes: number | null = null;
    if (values.auto_lunch) {
      mealAfter = parsePositiveMinutes(values.meal_deduct_after_minutes);
      mealMinutes = parsePositiveMinutes(values.meal_deduct_minutes);
      if (mealAfter === null || mealMinutes === null) {
        setFormError("Automatic lunch needs whole minutes greater than zero");
        return;
      }
    }
    try {
      await upsert.mutateAsync({
        id: row?.id,
        values: {
          effective_from: values.effective_from,
          sut_rate_bp: sutRateBp,
          swh_method: values.swh_method,
          pay_frequency: values.pay_frequency,
          daily_ot_mode: values.daily_ot_mode,
          workweek_start_day: values.workweek_start_day,
          time_zone: values.time_zone.trim() || "America/Puerto_Rico",
          punch_rounding: values.punch_rounding,
          hourly_pay_rounding: values.hourly_pay_rounding,
          meal_deduct_after_minutes: mealAfter,
          meal_deduct_minutes: mealMinutes,
          notes: values.notes.trim() || null,
        },
      });
      onOpenChange(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save employer settings");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={row ? "Edit employer settings" : "Add employer settings"}
      description="SUT is entered as a percent and stored in basis points. Pay frequency applies to org-wide runs."
    >
      <form id="employer-settings-form" className="grid grid-cols-2 gap-3" onSubmit={(e) => void onSubmit(e)}>
        <Field label="Effective from" htmlFor="employer-effective">
          <Input
            id="employer-effective"
            type="date"
            required
            value={values.effective_from}
            onChange={(e) => setValues((current) => ({ ...current, effective_from: e.target.value }))}
          />
        </Field>
        <Field label="SUT rate (%)" htmlFor="employer-sut">
          <Input
            id="employer-sut"
            required
            inputMode="decimal"
            value={values.sut_percent}
            onChange={(e) => setValues((current) => ({ ...current, sut_percent: e.target.value }))}
          />
        </Field>
        <Field label="SWH method" htmlFor="employer-swh">
          <Select
            id="employer-swh"
            value={values.swh_method}
            onChange={(e) =>
              setValues((current) => ({
                ...current,
                swh_method: e.target.value as FormState["swh_method"],
              }))
            }
          >
            <option value="annualized">Annualized</option>
            <option value="biweekly_table">Biweekly table</option>
          </Select>
        </Field>
        <Field label="Pay frequency" htmlFor="employer-frequency">
          <Select
            id="employer-frequency"
            value={values.pay_frequency}
            onChange={(e) =>
              setValues((current) => ({
                ...current,
                pay_frequency: e.target.value as PayFrequency,
              }))
            }
          >
            <option value="weekly">Weekly</option>
            <option value="biweekly">Biweekly</option>
          </Select>
        </Field>
        <Field label="Daily OT window" htmlFor="employer-ot">
          <Select
            id="employer-ot"
            value={values.daily_ot_mode}
            onChange={(e) =>
              setValues((current) => ({
                ...current,
                daily_ot_mode: e.target.value as DailyWindowMode,
              }))
            }
          >
            <option value="rolling_24h">Rolling 24h</option>
            <option value="calendar_day">Calendar day</option>
            <option value="clock_in_day">Clock-in day (whole shift counts on the day it starts)</option>
          </Select>
        </Field>
        <Field label="Punch rounding" htmlFor="employer-punch-rounding">
          <Select
            id="employer-punch-rounding"
            value={values.punch_rounding}
            onChange={(e) =>
              setValues((current) => ({
                ...current,
                punch_rounding: e.target.value as FormState["punch_rounding"],
              }))
            }
          >
            <option value="none">None</option>
            <option value="hundredth_hour">Round each punch to 0.01 h</option>
          </Select>
        </Field>
        <Field label="Hourly pay rounding" htmlFor="employer-hourly-rounding">
          <Select
            id="employer-hourly-rounding"
            value={values.hourly_pay_rounding}
            onChange={(e) =>
              setValues((current) => ({
                ...current,
                hourly_pay_rounding: e.target.value as FormState["hourly_pay_rounding"],
              }))
            }
          >
            <option value="per_line">Per line</option>
            <option value="period">Once per period</option>
          </Select>
        </Field>
        <Field label="Workweek starts" htmlFor="employer-week">
          <Select
            id="employer-week"
            value={String(values.workweek_start_day)}
            onChange={(e) =>
              setValues((current) => ({ ...current, workweek_start_day: Number(e.target.value) }))
            }
          >
            {WEEKDAYS.map((label, day) => (
              <option key={label} value={day}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Time zone" htmlFor="employer-tz">
          <Input
            id="employer-tz"
            required
            value={values.time_zone}
            onChange={(e) => setValues((current) => ({ ...current, time_zone: e.target.value }))}
          />
        </Field>
        <div className="col-span-2">
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={values.auto_lunch}
              onChange={(e) =>
                setValues((current) => ({
                  ...current,
                  auto_lunch: e.target.checked,
                  meal_deduct_after_minutes: e.target.checked
                    ? current.meal_deduct_after_minutes || DEFAULT_MEAL_AFTER_MINUTES
                    : current.meal_deduct_after_minutes,
                  meal_deduct_minutes: e.target.checked
                    ? current.meal_deduct_minutes || DEFAULT_MEAL_DEDUCT_MINUTES
                    : current.meal_deduct_minutes,
                }))
              }
            />
            Automatic lunch
          </label>
        </div>
        {values.auto_lunch ? (
          <>
            <Field label="After N minutes" htmlFor="employer-lunch-after">
              <Input
                id="employer-lunch-after"
                inputMode="numeric"
                value={values.meal_deduct_after_minutes}
                onChange={(e) =>
                  setValues((current) => ({ ...current, meal_deduct_after_minutes: e.target.value }))
                }
              />
            </Field>
            <Field label="Deduct N minutes" htmlFor="employer-lunch-deduct">
              <Input
                id="employer-lunch-deduct"
                inputMode="numeric"
                value={values.meal_deduct_minutes}
                onChange={(e) =>
                  setValues((current) => ({ ...current, meal_deduct_minutes: e.target.value }))
                }
              />
            </Field>
          </>
        ) : null}
        <div className="col-span-2 rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink">
          Puerto Rico law requires a real meal period; check with your accountant before relying on automatic
          deductions.
        </div>
        <div className="col-span-2">
          <Field label="Notes" htmlFor="employer-notes">
            <Textarea
              id="employer-notes"
              value={values.notes}
              onChange={(e) => setValues((current) => ({ ...current, notes: e.target.value }))}
            />
          </Field>
        </div>
      </form>
      {formError ? <p className="mt-3 text-sm text-danger">{formError}</p> : null}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" form="employer-settings-form" disabled={upsert.isPending}>
          {upsert.isPending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </Dialog>
  );
}
