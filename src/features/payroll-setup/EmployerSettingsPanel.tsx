import { useEffect, useState, type FormEvent } from "react";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Input, Select, Textarea } from "../../components/ui/input";
import { Field } from "../../components/ui/label";
import { Table, THead, Td, Th } from "../../components/ui/table";
import { basisPointsToPercentInput, percentToBasisPoints } from "../../lib/payroll/setup";
import type { PayrollEmployerSettingsRow } from "../../lib/types";
import {
  useDeletePayrollEmployerSettings,
  usePayrollEmployerSettings,
  useUpsertPayrollEmployerSettings,
} from "./hooks";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

type FormState = {
  effective_from: string;
  sut_percent: string;
  swh_method: PayrollEmployerSettingsRow["swh_method"];
  daily_ot_mode: PayrollEmployerSettingsRow["daily_ot_mode"];
  workweek_start_day: number;
  time_zone: string;
  notes: string;
};

const empty: FormState = {
  effective_from: "",
  sut_percent: "2.70",
  swh_method: "annualized",
  daily_ot_mode: "rolling_24h",
  workweek_start_day: 0,
  time_zone: "America/Puerto_Rico",
  notes: "",
};

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
              <Th>Daily OT</Th>
              <Th>Workweek</Th>
              <Th>Time zone</Th>
              <Th />
            </tr>
          </THead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <Td colSpan={7} className="py-10 text-center text-muted">
                  No employer settings yet.
                </Td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <Td>{row.effective_from}</Td>
                  <Td>{basisPointsToPercentInput(row.sut_rate_bp)}%</Td>
                  <Td>{row.swh_method === "biweekly_table" ? "Biweekly table" : "Annualized"}</Td>
                  <Td>{row.daily_ot_mode === "calendar_day" ? "Calendar day" : "Rolling 24h"}</Td>
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
      setValues({
        effective_from: row.effective_from,
        sut_percent: basisPointsToPercentInput(row.sut_rate_bp),
        swh_method: row.swh_method,
        daily_ot_mode: row.daily_ot_mode,
        workweek_start_day: row.workweek_start_day,
        time_zone: row.time_zone,
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
    try {
      await upsert.mutateAsync({
        id: row?.id,
        values: {
          effective_from: values.effective_from,
          sut_rate_bp: sutRateBp,
          swh_method: values.swh_method,
          pay_frequency: "biweekly",
          daily_ot_mode: values.daily_ot_mode,
          workweek_start_day: values.workweek_start_day,
          time_zone: values.time_zone.trim() || "America/Puerto_Rico",
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
      description="SUT is entered as a percent and stored in basis points. Pay frequency is biweekly."
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
        <Field label="Daily OT window" htmlFor="employer-ot">
          <Select
            id="employer-ot"
            value={values.daily_ot_mode}
            onChange={(e) =>
              setValues((current) => ({
                ...current,
                daily_ot_mode: e.target.value as FormState["daily_ot_mode"],
              }))
            }
          >
            <option value="rolling_24h">Rolling 24h</option>
            <option value="calendar_day">Calendar day</option>
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
