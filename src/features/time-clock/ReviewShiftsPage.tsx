import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Dialog } from "../../components/ui/dialog";
import { Input, Select, Textarea } from "../../components/ui/input";
import { Field } from "../../components/ui/label";
import { Table, THead, Td, Th } from "../../components/ui/table";
import { isYmd } from "../../lib/payroll-engine/hours/time";
import { isManager } from "../../lib/schedule";
import { BREAK_TYPES, formatInTimeZone, formatTimeInZone, type BreakType } from "../../lib/time-clock";
import {
  buildTimeEntryRpcPayload,
  formFromTimeEntry,
  formatWorkedHours,
  groupTimeEntriesForReview,
  type TimeEntryFormBreak,
  type TimeEntryRpcPayload,
  type ReviewShiftRow,
} from "../../lib/time-entries/edit";
import type { TimeEntryEdit } from "../../lib/types";
import { useEmployees } from "../employees/hooks";
import { useRestaurants } from "../invoices/hooks";
import { useSaveTimeEntry, useTimeEntryReview, useVoidTimeEntry } from "./hooks";

function isYmdParam(value: string | null): string {
  return value && isYmd(value) ? value : "";
}

function actionLabel(action: TimeEntryEdit["action"]): string {
  switch (action) {
    case "create":
      return "Created";
    case "update":
      return "Updated";
    case "void":
      return "Voided";
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

function emptyBreak(): TimeEntryFormBreak {
  return { startedAt: "", endedAt: "", breakType: "meal", paid: false };
}

export function ReviewShiftsPage() {
  const { org, role } = useAuth();
  const manager = isManager(role);
  const timeZone = org?.timezone ?? "America/Puerto_Rico";
  const [params, setParams] = useSearchParams();
  const periodStart = isYmdParam(params.get("start"));
  const periodEnd = isYmdParam(params.get("end"));
  const review = useTimeEntryReview(periodStart, periodEnd);
  const employees = useEmployees();
  const restaurants = useRestaurants();
  const save = useSaveTimeEntry();
  const voidEntry = useVoidTimeEntry();

  const [editor, setEditor] = useState<"add" | ReviewShiftRow | null>(null);
  const [voiding, setVoiding] = useState<ReviewShiftRow | null>(null);

  const names = useMemo(() => {
    const map: Record<string, string> = {};
    for (const row of employees.data ?? []) map[row.id] = row.full_name;
    return map;
  }, [employees.data]);
  const editorNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const row of employees.data ?? []) {
      if (row.user_id) map[row.user_id] = row.full_name;
    }
    return map;
  }, [employees.data]);
  const restaurantNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const row of restaurants.data ?? []) map[row.id] = row.name;
    return map;
  }, [restaurants.data]);

  const groups = useMemo(() => {
    if (!review.data || !periodStart || !periodEnd) return [];
    return groupTimeEntriesForReview({
      entries: review.data.entries,
      breaks: review.data.breaks,
      exceptions: review.data.exceptions,
      edits: review.data.edits,
      windows: review.data.windows,
      names,
      timeZone,
      periodStart,
      periodEnd,
    });
  }, [names, periodEnd, periodStart, review.data, timeZone]);

  if (!manager) {
    return <p className="text-sm text-muted">Reviewing shifts is limited to managers and admins.</p>;
  }

  const setPeriod = (start: string, end: string) => {
    const next = new URLSearchParams();
    if (start) next.set("start", start);
    if (end) next.set("end", end);
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-5">
      <div className="mb-4 flex flex-wrap items-center gap-2 md:flex-nowrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Review shifts</h1>
          <p className="mt-1 text-sm text-muted">
            Correct Time Clock shifts for a pay period before payroll. Each change needs a reason.
          </p>
        </div>
        <Button className="w-full sm:ml-auto sm:w-auto" onClick={() => setEditor("add")}>
          Add shift
        </Button>
      </div>

      <Card className="grid gap-3 sm:grid-cols-2">
        <Field label="Period start" htmlFor="shift-start">
          <Input
            id="shift-start"
            type="date"
            value={periodStart}
            onChange={(event) => setPeriod(event.target.value, periodEnd)}
          />
        </Field>
        <Field label="Period end" htmlFor="shift-end">
          <Input
            id="shift-end"
            type="date"
            value={periodEnd}
            onChange={(event) => setPeriod(periodStart, event.target.value)}
          />
        </Field>
      </Card>

      {!periodStart || !periodEnd ? (
        <p className="text-sm text-muted">Choose a period start and end to load shifts.</p>
      ) : review.isLoading ? (
        <p className="text-sm text-muted">Loading shifts…</p>
      ) : review.error ? (
        <p className="text-sm text-danger">{review.error.message}</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted">No closed shifts in this period.</p>
      ) : (
        groups.map((group) => (
          <Card key={group.employeeId} className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold tracking-tight">{group.name}</h2>
              <p className="text-sm text-muted">{formatWorkedHours(group.totalWorkedSeconds)} hours</p>
            </div>
            <Table>
              <THead>
                <tr>
                  <Th>Date</Th>
                  <Th>Restaurant</Th>
                  <Th>Position</Th>
                  <Th>In</Th>
                  <Th>Out</Th>
                  <Th>Breaks</Th>
                  <Th>Worked</Th>
                  <Th>Flags</Th>
                  <Th></Th>
                </tr>
              </THead>
              <tbody>
                {group.shifts.map((row) => {
                  const locked = Boolean(row.approvedCheckDate);
                  return (
                    <tr key={row.entry.id}>
                      <Td>{formatInTimeZone(row.entry.started_at, timeZone).split(",")[0]}</Td>
                      <Td>{row.entry.restaurant_id ? (restaurantNames[row.entry.restaurant_id] ?? row.entry.restaurant_id) : "—"}</Td>
                      <Td>{row.entry.position}</Td>
                      <Td>{formatTimeInZone(row.entry.started_at, timeZone)}</Td>
                      <Td>{formatTimeInZone(row.entry.ended_at, timeZone)}</Td>
                      <Td>
                        {row.breaks.length === 0
                          ? "—"
                          : row.breaks
                              .map(
                                (item) =>
                                  `${formatTimeInZone(item.started_at, timeZone)}–${formatTimeInZone(item.ended_at, timeZone)} ${item.break_type}${item.paid ? " paid" : ""}`,
                              )
                              .join("; ")}
                      </Td>
                      <Td>{formatWorkedHours(row.workedSeconds)}</Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          {row.hasOpenException ? <Badge tone="warn">Exception</Badge> : null}
                          {row.noRestaurant ? <Badge tone="warn">No restaurant — not paid</Badge> : null}
                          {row.edited ? <Badge>Edited</Badge> : null}
                          {row.approvedCheckDate ? <Badge tone="info">In approved run</Badge> : null}
                        </div>
                      </Td>
                      <Td>
                        <div className="flex gap-1">
                          <Button variant="subtle" disabled={locked} onClick={() => setEditor(row)}>
                            Edit
                          </Button>
                          <Button variant="subtle" disabled={locked} onClick={() => setVoiding(row)}>
                            Void
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>
        ))
      )}

      {editor ? (
        <ShiftEditorDialog
          mode={editor === "add" ? "add" : "edit"}
          row={editor === "add" ? null : editor}
          timeZone={timeZone}
          employees={employees.data ?? []}
          restaurants={restaurants.data ?? []}
          edits={review.data?.edits ?? []}
          editorNames={editorNames}
          busy={save.isPending}
          onClose={() => setEditor(null)}
          onSave={async (payload) => {
            await save.mutateAsync(payload);
            setEditor(null);
          }}
        />
      ) : null}

      {voiding ? (
        <VoidShiftDialog
          row={voiding}
          timeZone={timeZone}
          busy={voidEntry.isPending}
          onClose={() => setVoiding(null)}
          onVoid={async (reason) => {
            await voidEntry.mutateAsync({ target_entry_id: voiding.entry.id, reason });
            setVoiding(null);
          }}
        />
      ) : null}
    </div>
  );
}

function ShiftEditorDialog({
  mode,
  row,
  timeZone,
  employees,
  restaurants,
  edits,
  editorNames,
  busy,
  onClose,
  onSave,
}: {
  mode: "add" | "edit";
  row: ReviewShiftRow | null;
  timeZone: string;
  employees: Array<{ id: string; full_name: string; position: string; home_restaurant_id: string | null }>;
  restaurants: Array<{ id: string; name: string }>;
  edits: TimeEntryEdit[];
  editorNames: Record<string, string>;
  busy: boolean;
  onClose: () => void;
  onSave: (payload: TimeEntryRpcPayload) => Promise<void>;
}) {
  const seeded = row ? formFromTimeEntry(row.entry, row.breaks, timeZone) : null;
  const [employeeId, setEmployeeId] = useState(seeded?.employeeId ?? "");
  const [restaurantId, setRestaurantId] = useState(seeded?.restaurantId ?? "");
  const [position, setPosition] = useState(seeded?.position ?? "");
  const [date, setDate] = useState(seeded?.date ?? "");
  const [start, setStart] = useState(seeded?.start ?? "");
  const [end, setEnd] = useState(seeded?.end ?? "");
  const [breaks, setBreaks] = useState<TimeEntryFormBreak[]>(seeded?.breaks.length ? [...seeded.breaks] : []);
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const history = row ? edits.filter((item) => item.time_entry_id === row.entry.id) : [];

  const submit = async () => {
    setFormError(null);
    const built = buildTimeEntryRpcPayload({
      entryId: row?.entry.id ?? null,
      employeeId,
      restaurantId,
      position,
      date,
      start,
      end,
      breaks,
      reason,
      timeZone,
    });
    if (!built.ok) {
      setFormError(built.error);
      return;
    }
    try {
      await onSave(built.payload);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not save shift");
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={mode === "add" ? "Add shift" : "Edit shift"}
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Employee" htmlFor="shift-employee">
          <Select
            id="shift-employee"
            value={employeeId}
            disabled={mode === "edit"}
            onChange={(event) => {
              const next = event.target.value;
              setEmployeeId(next);
              const employee = employees.find((item) => item.id === next);
              if (employee && !position) setPosition(employee.position);
              if (employee && !restaurantId) setRestaurantId(employee.home_restaurant_id ?? "");
            }}
          >
            <option value="">Select…</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.full_name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Restaurant" htmlFor="shift-restaurant">
          <Select id="shift-restaurant" value={restaurantId} onChange={(event) => setRestaurantId(event.target.value)}>
            <option value="">Select…</option>
            {restaurants.map((restaurant) => (
              <option key={restaurant.id} value={restaurant.id}>
                {restaurant.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Position" htmlFor="shift-position">
          <Input id="shift-position" value={position} onChange={(event) => setPosition(event.target.value)} />
        </Field>
        <Field label="Date" htmlFor="shift-date">
          <Input id="shift-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <Field label="In" htmlFor="shift-in">
          <Input id="shift-in" type="time" value={start} onChange={(event) => setStart(event.target.value)} />
        </Field>
        <Field label="Out" htmlFor="shift-out">
          <Input id="shift-out" type="time" value={end} onChange={(event) => setEnd(event.target.value)} />
        </Field>
      </div>
      <p className="mt-2 text-xs font-medium text-muted">Overnight shifts are allowed when out is earlier than in.</p>

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Breaks</h3>
          <Button variant="ghost" onClick={() => setBreaks((current) => [...current, emptyBreak()])}>
            Add break
          </Button>
        </div>
        {breaks.map((item, index) => (
          <div key={index} className="grid gap-2 sm:grid-cols-5">
            <Input
              type="time"
              value={item.startedAt}
              aria-label={`Break ${index + 1} start`}
              onChange={(event) =>
                setBreaks((current) => current.map((row, i) => (i === index ? { ...row, startedAt: event.target.value } : row)))
              }
            />
            <Input
              type="time"
              value={item.endedAt}
              aria-label={`Break ${index + 1} end`}
              onChange={(event) =>
                setBreaks((current) => current.map((row, i) => (i === index ? { ...row, endedAt: event.target.value } : row)))
              }
            />
            <Select
              value={item.breakType}
              aria-label={`Break ${index + 1} type`}
              onChange={(event) =>
                setBreaks((current) =>
                  current.map((row, i) => (i === index ? { ...row, breakType: event.target.value as BreakType } : row)),
                )
              }
            >
              {BREAK_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={item.paid}
                onChange={(event) =>
                  setBreaks((current) => current.map((row, i) => (i === index ? { ...row, paid: event.target.checked } : row)))
                }
              />
              Paid
            </label>
            <Button
              variant="subtle"
              onClick={() => setBreaks((current) => current.filter((_, i) => i !== index))}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>

      <Field label="Reason" htmlFor="shift-reason">
        <Textarea
          id="shift-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Required"
        />
      </Field>
      {formError ? <p className="text-sm text-danger">{formError}</p> : null}

      {row ? (
        <div className="mt-4">
          <h3 className="text-sm font-semibold">Edit history</h3>
          {history.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No previous edits.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {history.map((item) => (
                <li key={item.id} className="text-sm text-ink">
                  <span className="font-medium">{actionLabel(item.action)}</span>
                  {" · "}
                  {editorNames[item.edited_by ?? ""] ?? "Manager"}
                  {" · "}
                  {formatInTimeZone(item.edited_at, timeZone)}
                  {" · "}
                  {item.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </Dialog>
  );
}

function VoidShiftDialog({
  row,
  timeZone,
  busy,
  onClose,
  onVoid,
}: {
  row: ReviewShiftRow;
  timeZone: string;
  busy: boolean;
  onClose: () => void;
  onVoid: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Void shift"
      description={`${formatInTimeZone(row.entry.started_at, timeZone)} · ${row.entry.position}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={busy || !reason.trim()}
            onClick={() => {
              void (async () => {
                setFormError(null);
                try {
                  await onVoid(reason.trim());
                } catch (error) {
                  setFormError(error instanceof Error ? error.message : "Could not void shift");
                }
              })();
            }}
          >
            {busy ? "Voiding…" : "Void"}
          </Button>
        </>
      }
    >
      <Field label="Reason" htmlFor="void-reason">
        <Textarea id="void-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
      {formError ? <p className="mt-2 text-sm text-danger">{formError}</p> : null}
    </Dialog>
  );
}

