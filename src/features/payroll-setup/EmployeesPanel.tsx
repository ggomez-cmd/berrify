import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Input, Select, Textarea } from "../../components/ui/input";
import { Field } from "../../components/ui/label";
import { Table, THead, Td, Th } from "../../components/ui/table";
import { STATIONS } from "../../lib/constants";
import {
  buildPayrollEmployeeSetupProfile,
  buildPayrollPayRateSetupPayloads,
  centsToDollarInput,
  type PayrollEmployeeSetupDraft,
} from "../../lib/payroll/setup";
import type { EmployeePayType, PersonalExemptionStatus } from "../../lib/payroll-engine/types";
import type { Employee, PayrollEmployeeProfileRow, PayrollPayRateRow } from "../../lib/types";
import { useEmployees } from "../employees/hooks";
import { useRestaurants } from "../invoices/hooks";
import { usePayrollEmployeeProfiles, usePayrollPayRates, useSavePayrollEmployeeSetup } from "./hooks";

const EXEMPTIONS: Array<{ id: PersonalExemptionStatus; label: string }> = [
  { id: "none", label: "None" },
  { id: "single", label: "Single" },
  { id: "married_claiming_half", label: "Married, claiming half" },
  { id: "married_claiming_all", label: "Married, claiming all" },
  { id: "optional_computation", label: "Optional computation" },
];

type RateDraft = {
  key: string;
  restaurant_id: string;
  position: string;
  rate_dollars: string;
  effective_from: string;
};

const emptyProfile: PayrollEmployeeSetupDraft = {
  employee_number: "",
  pay_type: "payroll",
  is_tipped: false,
  hire_date: "",
  daily_ot_multiplier_ppm: "1500000",
  weekly_ot_multiplier_ppm: "1500000",
  default_restaurant_id: "",
  salary_dollars: "",
  personal_exemption: "none",
  veteran: false,
  dependents: "0",
  reduced_dependents: "0",
  deduction_dollars: "0.00",
  annual_exemption_override_dollars: "",
  biweekly_exemption_override_dollars: "",
  young_worker_exempt: false,
  additional_withholding_dollars: "0.00",
  r41_effective_date: "",
  notes: "",
};

export function EmployeesPanel() {
  const { data: employees = [], isLoading, error } = useEmployees();
  const profilesQuery = usePayrollEmployeeProfiles();
  const ratesQuery = usePayrollPayRates();
  const { data: restaurants = [] } = useRestaurants();
  const [editing, setEditing] = useState<Employee | null>(null);
  const setupReady = profilesQuery.isSuccess && ratesQuery.isSuccess;

  const profileByEmployee = useMemo(() => {
    const map = new Map<string, PayrollEmployeeProfileRow>();
    for (const row of profilesQuery.data ?? []) map.set(row.employee_id, row);
    return map;
  }, [profilesQuery.data]);

  const rateCountByEmployee = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of ratesQuery.data ?? []) map.set(row.employee_id, (map.get(row.employee_id) ?? 0) + 1);
    return map;
  }, [ratesQuery.data]);

  const restaurantName = useMemo(() => {
    const map = new Map(restaurants.map((row) => [row.id, row.name]));
    return (id: string | null | undefined) => (id ? (map.get(id) ?? "—") : "—");
  }, [restaurants]);

  const active = employees.filter((employee) => employee.active);

  return (
    <div>
      {error ? <p className="mb-3 text-sm text-danger">{error.message}</p> : null}
      {profilesQuery.error ? <p className="mb-3 text-sm text-danger">{profilesQuery.error.message}</p> : null}
      {ratesQuery.error ? <p className="mb-3 text-sm text-danger">{ratesQuery.error.message}</p> : null}
      {isLoading ? <p className="text-sm text-muted">Loading employees…</p> : null}
      {!setupReady && !profilesQuery.error && !ratesQuery.error ? (
        <p className="mb-3 text-sm text-muted">Loading payroll profiles and rates…</p>
      ) : null}
      {!isLoading ? (
        <Table>
          <THead>
            <tr>
              <Th>Employee</Th>
              <Th>Number</Th>
              <Th>Pay type</Th>
              <Th>Tipped</Th>
              <Th>Default class</Th>
              <Th>Rates</Th>
              <Th />
            </tr>
          </THead>
          <tbody>
            {active.length === 0 ? (
              <tr>
                <Td colSpan={7} className="py-10 text-center text-muted">
                  No active employees.
                </Td>
              </tr>
            ) : (
              active.map((employee) => {
                const profile = profileByEmployee.get(employee.id);
                return (
                  <tr key={employee.id}>
                    <Td>
                      <div className="font-medium">{employee.full_name}</div>
                      <div className="text-xs text-muted">{employee.position}</div>
                    </Td>
                    <Td>{profile?.employee_number ?? "—"}</Td>
                    <Td>{profile?.pay_type === "cash" ? "Cash" : profile ? "Payroll" : "—"}</Td>
                    <Td>
                      {profile ? (
                        <Badge tone={profile.is_tipped ? "warn" : "neutral"}>{profile.is_tipped ? "Tipped" : "No"}</Badge>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td>{restaurantName(profile?.default_restaurant_id)}</Td>
                    <Td>{setupReady ? (rateCountByEmployee.get(employee.id) ?? 0) : "—"}</Td>
                    <Td>
                      <div className="flex justify-end">
                        <Button variant="subtle" disabled={!setupReady} onClick={() => setEditing(employee)}>
                          Edit
                        </Button>
                      </div>
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </Table>
      ) : null}
      <EmployeePayrollDialog
        employee={editing}
        profile={editing ? (profileByEmployee.get(editing.id) ?? null) : null}
        rates={
          editing && ratesQuery.isSuccess
            ? (ratesQuery.data ?? []).filter((row) => row.employee_id === editing.id)
            : []
        }
        setupReady={setupReady}
        loadError={
          profilesQuery.error?.message ?? ratesQuery.error?.message ?? null
        }
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
    </div>
  );
}

function EmployeePayrollDialog({
  employee,
  profile,
  rates,
  setupReady,
  loadError,
  onOpenChange,
}: {
  employee: Employee | null;
  profile: PayrollEmployeeProfileRow | null;
  rates: PayrollPayRateRow[];
  setupReady: boolean;
  loadError: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: restaurants = [] } = useRestaurants();
  const save = useSavePayrollEmployeeSetup();
  const [values, setValues] = useState<PayrollEmployeeSetupDraft>(emptyProfile);
  const [rateDrafts, setRateDrafts] = useState<RateDraft[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [ratesDraftReady, setRatesDraftReady] = useState(false);

  useEffect(() => {
    if (!employee || !setupReady) {
      setRatesDraftReady(false);
      return;
    }
    if (profile) {
      setValues({
        employee_number: profile.employee_number ?? "",
        pay_type: profile.pay_type,
        is_tipped: profile.is_tipped,
        hire_date: profile.hire_date ?? "",
        daily_ot_multiplier_ppm: String(profile.daily_ot_multiplier_ppm),
        weekly_ot_multiplier_ppm: String(profile.weekly_ot_multiplier_ppm),
        default_restaurant_id: profile.default_restaurant_id ?? "",
        salary_dollars: profile.salary_cents == null ? "" : centsToDollarInput(profile.salary_cents),
        personal_exemption: profile.personal_exemption,
        veteran: profile.veteran,
        dependents: String(profile.dependents),
        reduced_dependents: String(profile.reduced_dependents),
        deduction_dollars: centsToDollarInput(profile.deduction_cents),
        annual_exemption_override_dollars:
          profile.annual_exemption_override_cents == null
            ? ""
            : centsToDollarInput(profile.annual_exemption_override_cents),
        biweekly_exemption_override_dollars:
          profile.biweekly_exemption_override_cents == null
            ? ""
            : centsToDollarInput(profile.biweekly_exemption_override_cents),
        young_worker_exempt: profile.young_worker_exempt,
        additional_withholding_dollars: centsToDollarInput(profile.additional_withholding_cents),
        r41_effective_date: profile.r41_effective_date ?? "",
        notes: profile.notes ?? "",
      });
    } else {
      setValues(emptyProfile);
    }
    setRateDrafts(
      rates.map((row) => ({
        key: row.id,
        restaurant_id: row.restaurant_id ?? "",
        position: row.position ?? "",
        rate_dollars: centsToDollarInput(row.rate_cents),
        effective_from: row.effective_from,
      })),
    );
    setFormError(null);
    setRatesDraftReady(true);
  }, [employee, profile, rates, setupReady]);

  const canEdit = setupReady && ratesDraftReady;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!employee || !canEdit) return;
    setFormError(null);
    const profilePayload = buildPayrollEmployeeSetupProfile(values);
    if (!profilePayload.ok) {
      setFormError(profilePayload.error);
      return;
    }
    const ratePayload = buildPayrollPayRateSetupPayloads(rateDrafts);
    if (!ratePayload.ok) {
      setFormError(ratePayload.error);
      return;
    }
    try {
      await save.mutateAsync({
        employeeId: employee.id,
        profile: profilePayload.value,
        rates: ratePayload.value,
      });
      onOpenChange(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save payroll profile");
    }
  };

  return (
    <Dialog
      open={Boolean(employee)}
      onOpenChange={onOpenChange}
      title={employee ? `Payroll profile · ${employee.full_name}` : "Payroll profile"}
      description="Withholding and dated rates feed the payroll engine. Leave salary blank for hourly."
      size="lg"
    >
      <fieldset disabled={!canEdit} className="contents">
      <form id="payroll-profile-form" className="grid grid-cols-2 gap-3" onSubmit={(e) => void onSubmit(e)}>
        <Field label="Employee number" htmlFor="pay-number">
          <Input
            id="pay-number"
            value={values.employee_number}
            onChange={(e) => setValues((current) => ({ ...current, employee_number: e.target.value }))}
          />
        </Field>
        <Field label="Pay type" htmlFor="pay-type">
          <Select
            id="pay-type"
            value={values.pay_type}
            onChange={(e) => setValues((current) => ({ ...current, pay_type: e.target.value as EmployeePayType }))}
          >
            <option value="payroll">Payroll</option>
            <option value="cash">Cash</option>
          </Select>
        </Field>
        <Field label="Hire date" htmlFor="pay-hire">
          <Input
            id="pay-hire"
            type="date"
            value={values.hire_date}
            onChange={(e) => setValues((current) => ({ ...current, hire_date: e.target.value }))}
          />
        </Field>
        <Field label="Default restaurant / class" htmlFor="pay-class">
          <Select
            id="pay-class"
            value={values.default_restaurant_id}
            onChange={(e) => setValues((current) => ({ ...current, default_restaurant_id: e.target.value }))}
          >
            <option value="">None</option>
            {restaurants.map((restaurant) => (
              <option key={restaurant.id} value={restaurant.id}>
                {restaurant.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Salary (blank = hourly)" htmlFor="pay-salary">
          <Input
            id="pay-salary"
            inputMode="decimal"
            value={values.salary_dollars}
            onChange={(e) => setValues((current) => ({ ...current, salary_dollars: e.target.value }))}
          />
        </Field>
        <Field label="Form 499 R-4.1 date" htmlFor="pay-r41">
          <Input
            id="pay-r41"
            type="date"
            value={values.r41_effective_date}
            onChange={(e) => setValues((current) => ({ ...current, r41_effective_date: e.target.value }))}
          />
        </Field>
        <Field label="Daily OT multiplier (ppm)" htmlFor="pay-daily-ot">
          <Input
            id="pay-daily-ot"
            inputMode="numeric"
            value={values.daily_ot_multiplier_ppm}
            onChange={(e) => setValues((current) => ({ ...current, daily_ot_multiplier_ppm: e.target.value }))}
          />
        </Field>
        <Field label="Weekly OT multiplier (ppm)" htmlFor="pay-weekly-ot">
          <Input
            id="pay-weekly-ot"
            inputMode="numeric"
            value={values.weekly_ot_multiplier_ppm}
            onChange={(e) => setValues((current) => ({ ...current, weekly_ot_multiplier_ppm: e.target.value }))}
          />
        </Field>
        <Field label="Personal exemption" htmlFor="pay-exemption">
          <Select
            id="pay-exemption"
            value={values.personal_exemption}
            onChange={(e) =>
              setValues((current) => ({
                ...current,
                personal_exemption: e.target.value as PersonalExemptionStatus,
              }))
            }
          >
            {EXEMPTIONS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Dependents" htmlFor="pay-deps">
          <Input
            id="pay-deps"
            inputMode="numeric"
            value={values.dependents}
            onChange={(e) => setValues((current) => ({ ...current, dependents: e.target.value }))}
          />
        </Field>
        <Field label="Reduced dependents" htmlFor="pay-red-deps">
          <Input
            id="pay-red-deps"
            inputMode="numeric"
            value={values.reduced_dependents}
            onChange={(e) => setValues((current) => ({ ...current, reduced_dependents: e.target.value }))}
          />
        </Field>
        <Field label="Deduction" htmlFor="pay-deduction">
          <Input
            id="pay-deduction"
            inputMode="decimal"
            value={values.deduction_dollars}
            onChange={(e) => setValues((current) => ({ ...current, deduction_dollars: e.target.value }))}
          />
        </Field>
        <Field label="Annual exemption override" htmlFor="pay-annual">
          <Input
            id="pay-annual"
            inputMode="decimal"
            value={values.annual_exemption_override_dollars}
            onChange={(e) =>
              setValues((current) => ({ ...current, annual_exemption_override_dollars: e.target.value }))
            }
          />
        </Field>
        <Field label="Biweekly exemption override" htmlFor="pay-biweekly">
          <Input
            id="pay-biweekly"
            inputMode="decimal"
            value={values.biweekly_exemption_override_dollars}
            onChange={(e) =>
              setValues((current) => ({ ...current, biweekly_exemption_override_dollars: e.target.value }))
            }
          />
        </Field>
        <Field label="Additional withholding" htmlFor="pay-extra">
          <Input
            id="pay-extra"
            inputMode="decimal"
            value={values.additional_withholding_dollars}
            onChange={(e) => setValues((current) => ({ ...current, additional_withholding_dollars: e.target.value }))}
          />
        </Field>
        <div className="col-span-2 flex flex-wrap gap-4 text-sm text-muted">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={values.is_tipped}
              onChange={(e) => setValues((current) => ({ ...current, is_tipped: e.target.checked }))}
            />
            Tipped
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={values.veteran}
              onChange={(e) => setValues((current) => ({ ...current, veteran: e.target.checked }))}
            />
            Veteran
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={values.young_worker_exempt}
              onChange={(e) => setValues((current) => ({ ...current, young_worker_exempt: e.target.checked }))}
            />
            Young worker exempt
          </label>
        </div>
        <div className="col-span-2">
          <Field label="Notes" htmlFor="pay-notes">
            <Textarea
              id="pay-notes"
              value={values.notes}
              onChange={(e) => setValues((current) => ({ ...current, notes: e.target.value }))}
            />
          </Field>
        </div>
      </form>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-base font-semibold tracking-tight">Pay rates</h3>
          <Button
            variant="outline"
            onClick={() =>
              setRateDrafts((current) => [
                ...current,
                {
                  key: `new-${current.length}-${Date.now()}`,
                  restaurant_id: "",
                  position: "",
                  rate_dollars: "",
                  effective_from: "",
                },
              ])
            }
          >
            Add rate
          </Button>
        </div>
        <Table>
          <THead>
            <tr>
              <Th>Restaurant</Th>
              <Th>Position</Th>
              <Th>Rate</Th>
              <Th>Effective</Th>
              <Th />
            </tr>
          </THead>
          <tbody>
            {rateDrafts.length === 0 ? (
              <tr>
                <Td colSpan={5} className="py-6 text-center text-muted">
                  No dated rates. The roster hourly rate is not used by the engine.
                </Td>
              </tr>
            ) : (
              rateDrafts.map((draft) => (
                <tr key={draft.key}>
                  <Td>
                    <Select
                      value={draft.restaurant_id}
                      onChange={(e) =>
                        setRateDrafts((current) =>
                          current.map((row) =>
                            row.key === draft.key ? { ...row, restaurant_id: e.target.value } : row,
                          ),
                        )
                      }
                    >
                      <option value="">Any</option>
                      {restaurants.map((restaurant) => (
                        <option key={restaurant.id} value={restaurant.id}>
                          {restaurant.name}
                        </option>
                      ))}
                    </Select>
                  </Td>
                  <Td>
                    <Select
                      value={draft.position}
                      onChange={(e) =>
                        setRateDrafts((current) =>
                          current.map((row) => (row.key === draft.key ? { ...row, position: e.target.value } : row)),
                        )
                      }
                    >
                      <option value="">Any</option>
                      {STATIONS.map((station) => (
                        <option key={station} value={station}>
                          {station}
                        </option>
                      ))}
                    </Select>
                  </Td>
                  <Td>
                    <Input
                      inputMode="decimal"
                      value={draft.rate_dollars}
                      onChange={(e) =>
                        setRateDrafts((current) =>
                          current.map((row) =>
                            row.key === draft.key ? { ...row, rate_dollars: e.target.value } : row,
                          ),
                        )
                      }
                    />
                  </Td>
                  <Td>
                    <Input
                      type="date"
                      value={draft.effective_from}
                      onChange={(e) =>
                        setRateDrafts((current) =>
                          current.map((row) =>
                            row.key === draft.key ? { ...row, effective_from: e.target.value } : row,
                          ),
                        )
                      }
                    />
                  </Td>
                  <Td>
                    <Button
                      variant="subtle"
                      onClick={() => setRateDrafts((current) => current.filter((row) => row.key !== draft.key))}
                    >
                      Remove
                    </Button>
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </div>
      </fieldset>

      {loadError ? <p className="mt-3 text-sm text-danger">{loadError}</p> : null}
      {formError ? <p className="mt-3 text-sm text-danger">{formError}</p> : null}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" form="payroll-profile-form" disabled={!canEdit || save.isPending}>
          {save.isPending ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </Dialog>
  );
}
