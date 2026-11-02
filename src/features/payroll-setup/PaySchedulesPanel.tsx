import { useMemo, useState, type FormEvent } from "react";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Input, Select } from "../../components/ui/input";
import { Field } from "../../components/ui/label";
import { nextPeriod } from "../../lib/payroll/schedules";
import type { PayFrequency } from "../../lib/payroll-engine/types";
import type { PayrollPayScheduleRow, Restaurant } from "../../lib/types";
import { useRestaurants } from "../invoices/hooks";
import { usePayrollPaySchedules, useUpsertPayrollPaySchedule } from "./hooks";

type ScheduleDraft = {
  frequency: PayFrequency;
  anchor_period_start: string;
  check_lag_days: string;
  taxes_via_provider: boolean;
};

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function draftFromRow(row: PayrollPayScheduleRow): ScheduleDraft {
  return {
    frequency: row.frequency,
    anchor_period_start: row.anchor_period_start.slice(0, 10),
    check_lag_days: String(row.check_lag_days),
    taxes_via_provider: row.taxes_via_provider,
  };
}

const emptyDraft = (): ScheduleDraft => ({
  frequency: "biweekly",
  anchor_period_start: todayYmd(),
  check_lag_days: "5",
  taxes_via_provider: true,
});

export function PaySchedulesPanel() {
  const { data: restaurants = [], isLoading: restaurantsLoading, error: restaurantsError } = useRestaurants();
  const schedulesQuery = usePayrollPaySchedules();
  const [addingFor, setAddingFor] = useState<string | null>(null);

  const scheduleByRestaurant = useMemo(() => {
    const map = new Map<string, PayrollPayScheduleRow>();
    for (const row of schedulesQuery.data ?? []) map.set(row.restaurant_id, row);
    return map;
  }, [schedulesQuery.data]);

  return (
    <div className="grid gap-4">
      <p className="max-w-3xl text-sm text-muted">
        Each restaurant has its own weekly or biweekly pay schedule. Org-wide runs still use the employer
        pay frequency.
      </p>
      {restaurantsError ? <p className="text-sm text-danger">{restaurantsError.message}</p> : null}
      {schedulesQuery.error ? <p className="text-sm text-danger">{schedulesQuery.error.message}</p> : null}
      {restaurantsLoading || schedulesQuery.isLoading ? (
        <p className="text-sm text-muted">Loading pay schedules…</p>
      ) : null}
      {!restaurantsLoading && restaurants.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">No restaurants yet.</p>
        </Card>
      ) : null}
      {restaurants.map((restaurant) => {
        const existing = scheduleByRestaurant.get(restaurant.id) ?? null;
        const adding = addingFor === restaurant.id;
        if (!existing && !adding) {
          return (
            <Card key={restaurant.id}>
              <h2 className="text-base font-semibold tracking-tight">{restaurant.name}</h2>
              <p className="mt-2 text-sm text-muted">No pay schedule yet.</p>
              <div className="mt-4">
                <Button onClick={() => setAddingFor(restaurant.id)}>Add schedule</Button>
              </div>
            </Card>
          );
        }
        return (
          <ScheduleCard
            key={restaurant.id}
            restaurant={restaurant}
            row={existing}
            onCancelAdd={() => setAddingFor(null)}
            onSaved={() => setAddingFor(null)}
          />
        );
      })}
    </div>
  );
}

function ScheduleCard({
  restaurant,
  row,
  onCancelAdd,
  onSaved,
}: {
  restaurant: Restaurant;
  row: PayrollPayScheduleRow | null;
  onCancelAdd: () => void;
  onSaved: () => void;
}) {
  const upsert = useUpsertPayrollPaySchedule();
  const [values, setValues] = useState<ScheduleDraft>(row ? draftFromRow(row) : emptyDraft());
  const [formError, setFormError] = useState<string | null>(null);

  const preview = (() => {
    try {
      const lag = Number(values.check_lag_days);
      if (!values.anchor_period_start || !Number.isSafeInteger(lag) || lag < 0) return null;
      return nextPeriod(
        {
          frequency: values.frequency,
          anchor_period_start: values.anchor_period_start,
          check_lag_days: lag,
        },
        todayYmd(),
      );
    } catch {
      return null;
    }
  })();

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const lag = Number(values.check_lag_days);
    if (!values.anchor_period_start) {
      setFormError("First period start is required");
      return;
    }
    if (!Number.isSafeInteger(lag) || lag < 0 || lag > 31) {
      setFormError("Days from period end to check date must be a whole number from 0 to 31");
      return;
    }
    try {
      await upsert.mutateAsync({
        id: row?.id,
        restaurant_id: restaurant.id,
        frequency: values.frequency,
        anchor_period_start: values.anchor_period_start,
        check_lag_days: lag,
        taxes_via_provider: values.taxes_via_provider,
      });
      onSaved();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save pay schedule");
    }
  };

  return (
    <Card>
      <h2 className="text-base font-semibold tracking-tight">{restaurant.name}</h2>
      <form
        className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => void onSubmit(e)}
      >
        <Field label="Frequency" htmlFor={`schedule-frequency-${restaurant.id}`}>
          <Select
            id={`schedule-frequency-${restaurant.id}`}
            value={values.frequency}
            onChange={(e) =>
              setValues((current) => ({ ...current, frequency: e.target.value as PayFrequency }))
            }
          >
            <option value="weekly">Weekly</option>
            <option value="biweekly">Biweekly</option>
          </Select>
        </Field>
        <Field label="First period start" htmlFor={`schedule-anchor-${restaurant.id}`}>
          <Input
            id={`schedule-anchor-${restaurant.id}`}
            type="date"
            required
            value={values.anchor_period_start}
            onChange={(e) => setValues((current) => ({ ...current, anchor_period_start: e.target.value }))}
          />
        </Field>
        <Field label="Days from period end to check date" htmlFor={`schedule-lag-${restaurant.id}`}>
          <Input
            id={`schedule-lag-${restaurant.id}`}
            inputMode="numeric"
            value={values.check_lag_days}
            onChange={(e) => setValues((current) => ({ ...current, check_lag_days: e.target.value }))}
          />
        </Field>
        <label className="flex items-end gap-2 pb-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={values.taxes_via_provider}
            onChange={(e) =>
              setValues((current) => ({ ...current, taxes_via_provider: e.target.checked }))
            }
          />
          Taxes paid through payroll provider
        </label>
        <div className="sm:col-span-2 lg:col-span-4">
          {preview ? (
            <p className="text-sm text-muted">
              Next period {preview.periodStart} – {preview.periodEnd} · check {preview.checkDate}
            </p>
          ) : (
            <p className="text-sm text-muted">Set an anchor date to preview the next period.</p>
          )}
        </div>
        {formError ? <p className="text-sm text-danger sm:col-span-2 lg:col-span-4">{formError}</p> : null}
        <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
          {row ? null : (
            <Button type="button" variant="ghost" onClick={onCancelAdd}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={upsert.isPending}>
            {upsert.isPending ? "Saving…" : "Save schedule"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
