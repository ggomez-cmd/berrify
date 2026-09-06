import { useMemo, useState } from "react";
import { useAuth } from "../../auth/auth-context";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Input, Select, Textarea } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Table, THead, Td, Th } from "../../components/ui/table";
import { formatDuration } from "../../lib/format";
import { isManager } from "../../lib/schedule";
import {
  allowedEvents,
  CLOCK_EVENT_TYPES,
  clockStateFromSession,
  formatInTimeZone,
  type ClockEventType,
  type ClockState,
} from "../../lib/time-clock";
import { useEmployees, useMyEmployee } from "../employees/hooks";
import {
  useManagerForceClockOut,
  useManagerRecordPunch,
  useMyClockEvents,
  useMyClockSession,
  useOrgClockEvents,
  useReconcileAttendance,
  useRecordClockEvent,
  useResolveException,
  useTimeEntries,
  useTimeExceptions,
  useUpdateOrgClockSettings,
  useWhosWorking,
} from "./hooks";

type Tab = "clock" | "working" | "attendance" | "activity" | "exceptions" | "settings";

function stateLabel(state: ClockState): string {
  switch (state) {
    case "off_clock":
      return "Off clock";
    case "working":
      return "Working";
    case "on_break":
      return "On break";
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function actionLabel(event: ClockEventType): string {
  switch (event) {
    case "clock_in":
      return "Clock in";
    case "break_start":
      return "Start break";
    case "break_end":
      return "End break";
    case "clock_out":
      return "Clock out";
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

export function TimeClockPage() {
  const { role, org } = useAuth();
  const manager = isManager(role);
  const owner = role === "owner";
  const timeZone = org?.timezone ?? "America/Puerto_Rico";
  const [tab, setTab] = useState<Tab>("clock");

  const tabs: Array<{ id: Tab; label: string; managerOnly?: boolean; ownerOnly?: boolean }> = [
    { id: "clock", label: "Clock" },
    { id: "working", label: "Who’s working" },
    { id: "attendance", label: "Attendance", managerOnly: true },
    { id: "activity", label: "Activity", managerOnly: true },
    { id: "exceptions", label: "Exceptions", managerOnly: true },
    { id: "settings", label: "Settings", ownerOnly: true },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-line pb-2">
        {tabs
          .filter((item) => (!item.managerOnly || manager) && (!item.ownerOnly || owner))
          .map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                tab === item.id ? "bg-wine text-white" : "text-muted hover:bg-white hover:text-ink"
              }`}
            >
              {item.label}
            </button>
          ))}
      </div>

      {tab === "clock" ? <EmployeeClockPanel timeZone={timeZone} /> : null}
      {tab === "working" ? <WhosWorkingPanel manager={manager} timeZone={timeZone} /> : null}
      {tab === "attendance" && manager ? <AttendancePanel timeZone={timeZone} /> : null}
      {tab === "activity" && manager ? <ActivityPanel timeZone={timeZone} /> : null}
      {tab === "exceptions" && manager ? <ExceptionsPanel timeZone={timeZone} /> : null}
      {tab === "settings" && owner ? <SettingsPanel /> : null}
    </div>
  );
}

function EmployeeClockPanel({ timeZone }: { timeZone: string }) {
  const me = useMyEmployee();
  const sessionQuery = useMyClockSession();
  const eventsQuery = useMyClockEvents();
  const punch = useRecordClockEvent();
  const state = clockStateFromSession(sessionQuery.data?.state ?? null);
  const actions = allowedEvents(state);

  return (
    <div className="space-y-4">
      {!me.data && !me.isLoading ? (
        <p className="text-sm text-danger">No employee record is linked to this login, so you cannot punch.</p>
      ) : null}
      {me.data && !me.data.active ? (
        <p className="text-sm text-danger">This employee is inactive and cannot punch.</p>
      ) : null}
      {punch.error ? <p className="text-sm text-danger">{punch.error.message}</p> : null}
      {sessionQuery.error ? <p className="text-sm text-danger">{sessionQuery.error.message}</p> : null}

      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-muted">Current state</p>
            <p className="mt-1 text-2xl font-semibold text-navy">{stateLabel(state)}</p>
            {sessionQuery.data ? (
              <p className="mt-1 text-sm text-muted">
                Clocked in {formatInTimeZone(sessionQuery.data.clocked_in_at, timeZone)}
                {sessionQuery.data.break_started_at
                  ? ` · Break started ${formatInTimeZone(sessionQuery.data.break_started_at, timeZone)}`
                  : null}
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted">Ready to clock in</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {CLOCK_EVENT_TYPES.map((event) => (
              <Button
                key={event}
                variant={event === "clock_out" ? "danger" : event === "clock_in" ? "primary" : "ghost"}
                disabled={!actions.includes(event) || punch.isPending || !me.data?.active}
                onClick={() => punch.mutate({ event_type: event })}
              >
                {punch.isPending && actions.includes(event) ? "Saving…" : actionLabel(event)}
              </Button>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">Recent punches</h2>
        {eventsQuery.isLoading ? <p className="text-sm text-muted">Loading…</p> : null}
        {eventsQuery.error ? <p className="text-sm text-danger">{eventsQuery.error.message}</p> : null}
        <ul className="divide-y divide-line">
          {(eventsQuery.data ?? []).map((event) => (
            <li key={event.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="font-medium">{actionLabel(event.event_type)}</span>
              <span className="text-muted">{formatInTimeZone(event.occurred_at, timeZone)}</span>
            </li>
          ))}
          {(eventsQuery.data ?? []).length === 0 && !eventsQuery.isLoading ? (
            <li className="py-6 text-sm text-muted">No clock events yet.</li>
          ) : null}
        </ul>
      </Card>
    </div>
  );
}

function WhosWorkingPanel({ manager, timeZone }: { manager: boolean; timeZone: string }) {
  const working = useWhosWorking();
  const forceOut = useManagerForceClockOut();
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState<string>("");

  return (
    <div className="space-y-4">
      {working.error ? <p className="text-sm text-danger">{working.error.message}</p> : null}
      {forceOut.error ? <p className="text-sm text-danger">{forceOut.error.message}</p> : null}
      <Card>
        {working.isLoading ? <p className="text-sm text-muted">Loading…</p> : null}
        <ul className="divide-y divide-line">
          {(working.data ?? []).map((row) => (
            <li key={row.employee_id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>
                <span className="font-medium">{row.full_name}</span>
                <span className="ml-2 text-muted">{stateLabel(row.state)}</span>
              </span>
              {manager ? (
                <span className="text-muted">
                  {row.clocked_in_at ? `since ${formatInTimeZone(row.clocked_in_at, timeZone)}` : null}
                  <button
                    type="button"
                    className="ml-3 text-wine hover:underline"
                    onClick={() => setSelected(row.employee_id)}
                  >
                    Force out
                  </button>
                </span>
              ) : null}
            </li>
          ))}
          {(working.data ?? []).length === 0 && !working.isLoading ? (
            <li className="py-6 text-sm text-muted">Nobody is clocked in.</li>
          ) : null}
        </ul>
      </Card>
      {manager && selected ? (
        <Card>
          <p className="mb-2 text-sm font-medium">Force clock-out reason</p>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Required reason" />
          <div className="mt-3 flex gap-2">
            <Button
              disabled={!reason.trim() || forceOut.isPending}
              onClick={() =>
                forceOut.mutate(
                  { employee_id: selected, reason: reason.trim() },
                  {
                    onSuccess: () => {
                      setReason("");
                      setSelected("");
                    },
                  },
                )
              }
            >
              Confirm force-out
            </Button>
            <Button variant="ghost" onClick={() => setSelected("")}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function AttendancePanel({ timeZone }: { timeZone: string }) {
  const entries = useTimeEntries();
  const employees = useEmployees();
  const recordPunch = useManagerRecordPunch();
  const [employeeId, setEmployeeId] = useState("");
  const [eventType, setEventType] = useState<ClockEventType>("clock_in");
  const [occurredAt, setOccurredAt] = useState("");
  const [reason, setReason] = useState("");

  return (
    <div className="space-y-4">
      {entries.error ? <p className="text-sm text-danger">{entries.error.message}</p> : null}
      {recordPunch.error ? <p className="text-sm text-danger">{recordPunch.error.message}</p> : null}
      <Card>
        <h2 className="mb-3 font-semibold">Record missing punch</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label>Employee</Label>
            <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Select…</option>
              {(employees.data ?? []).map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.full_name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Event</Label>
            <Select value={eventType} onChange={(e) => setEventType(e.target.value as ClockEventType)}>
              {CLOCK_EVENT_TYPES.map((event) => (
                <option key={event} value={event}>
                  {actionLabel(event)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Occurred at</Label>
            <Input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
          </div>
          <div>
            <Label>Reason</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Required" />
          </div>
        </div>
        <div className="mt-3">
          <Button
            disabled={!employeeId || !occurredAt || !reason.trim() || recordPunch.isPending}
            onClick={() =>
              recordPunch.mutate({
                employee_id: employeeId,
                event_type: eventType,
                occurred_at: new Date(occurredAt).toISOString(),
                reason: reason.trim(),
              })
            }
          >
            Record punch
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">Derived time entries</h2>
        <Table>
          <THead>
            <tr>
              <Th>Employee</Th>
              <Th>Started</Th>
              <Th>Ended</Th>
              <Th>Worked</Th>
              <Th>Unpaid break</Th>
              <Th>Status</Th>
            </tr>
          </THead>
          <tbody>
            {(entries.data ?? []).map((entry) => (
              <tr key={entry.id}>
                <Td>{entry.employees?.full_name ?? entry.employee_id.slice(0, 8)}</Td>
                <Td>{formatInTimeZone(entry.started_at, timeZone)}</Td>
                <Td>{formatInTimeZone(entry.ended_at, timeZone)}</Td>
                <Td>{formatDuration(entry.worked_seconds)}</Td>
                <Td>{formatDuration(entry.unpaid_break_seconds)}</Td>
                <Td>
                  <Badge tone={entry.status === "exception" ? "warn" : "neutral"}>{entry.status}</Badge>
                </Td>
              </tr>
            ))}
            {(entries.data ?? []).length === 0 ? (
              <tr>
                <Td colSpan={6} className="py-8 text-center text-muted">
                  No closed sessions yet.
                </Td>
              </tr>
            ) : null}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

function ActivityPanel({ timeZone }: { timeZone: string }) {
  const events = useOrgClockEvents();
  return (
    <Card>
      {events.error ? <p className="text-sm text-danger">{events.error.message}</p> : null}
      <Table>
        <THead>
          <tr>
            <Th>When</Th>
            <Th>Employee</Th>
            <Th>Event</Th>
            <Th>Actor</Th>
            <Th>Source</Th>
          </tr>
        </THead>
        <tbody>
          {(events.data ?? []).map((event) => (
            <tr key={event.id}>
              <Td>{formatInTimeZone(event.occurred_at, timeZone)}</Td>
              <Td>{event.employees?.full_name ?? event.employee_id.slice(0, 8)}</Td>
              <Td>{actionLabel(event.event_type)}</Td>
              <Td>{event.actor_type}</Td>
              <Td>{event.source}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

function ExceptionsPanel({ timeZone }: { timeZone: string }) {
  const exceptions = useTimeExceptions();
  const reconcile = useReconcileAttendance();
  const resolve = useResolveException();

  return (
    <div className="space-y-4">
      {exceptions.error ? <p className="text-sm text-danger">{exceptions.error.message}</p> : null}
      {reconcile.error ? <p className="text-sm text-danger">{reconcile.error.message}</p> : null}
      <div>
        <Button variant="ghost" disabled={reconcile.isPending} onClick={() => reconcile.mutate()}>
          Reconcile open sessions
        </Button>
        <p className="mt-1 text-xs text-muted">
          Flags missed-out / missed-in. Does not invent a clock-out.
        </p>
      </div>
      <Card>
        <Table>
          <THead>
            <tr>
              <Th>Created</Th>
              <Th>Employee</Th>
              <Th>Type</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </THead>
          <tbody>
            {(exceptions.data ?? []).map((row) => (
              <tr key={row.id}>
                <Td>{formatInTimeZone(row.created_at, timeZone)}</Td>
                <Td>{row.employees?.full_name ?? row.employee_id.slice(0, 8)}</Td>
                <Td>{row.type}</Td>
                <Td>
                  <Badge tone={row.status === "open" ? "warn" : "ok"}>{row.status}</Badge>
                </Td>
                <Td>
                  {row.status === "open" ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="text-xs text-wine hover:underline"
                        onClick={() => resolve.mutate({ exception_id: row.id, new_status: "resolved" })}
                      >
                        Resolve
                      </button>
                      <button
                        type="button"
                        className="text-xs text-muted hover:underline"
                        onClick={() => resolve.mutate({ exception_id: row.id, new_status: "dismissed" })}
                      >
                        Dismiss
                      </button>
                    </div>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

function SettingsPanel() {
  const { org } = useAuth();
  const save = useUpdateOrgClockSettings();
  const [timezone, setTimezone] = useState(org?.timezone ?? "America/Puerto_Rico");
  const [dow, setDow] = useState(String(org?.workweek_start_dow ?? 0));
  const [startTime, setStartTime] = useState((org?.workweek_start_time ?? "00:00").slice(0, 5));
  const [mealPaid, setMealPaid] = useState(org?.default_meal_break_paid ?? false);
  const [restPaid, setRestPaid] = useState(org?.default_rest_break_paid ?? true);
  const days = useMemo(
    () => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    [],
  );

  return (
    <Card>
      {save.error ? <p className="mb-3 text-sm text-danger">{save.error.message}</p> : null}
      {save.isSuccess ? <p className="mb-3 text-sm text-ok">Saved.</p> : null}
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label>Timezone</Label>
          <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </div>
        <div>
          <Label>Workweek starts</Label>
          <Select value={dow} onChange={(e) => setDow(e.target.value)}>
            {days.map((label, index) => (
              <option key={label} value={index}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Workweek start time</Label>
          <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </div>
        <div className="flex flex-col justify-end gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={mealPaid} onChange={(e) => setMealPaid(e.target.checked)} />
            Meal breaks paid
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={restPaid} onChange={(e) => setRestPaid(e.target.checked)} />
            Rest breaks paid
          </label>
        </div>
      </div>
      <div className="mt-4">
        <Button
          disabled={save.isPending}
          onClick={() =>
            save.mutate({
              timezone,
              workweek_start_dow: Number(dow),
              workweek_start_time: startTime,
              default_meal_break_paid: mealPaid,
              default_rest_break_paid: restPaid,
            })
          }
        >
          Save settings
        </Button>
      </div>
    </Card>
  );
}
