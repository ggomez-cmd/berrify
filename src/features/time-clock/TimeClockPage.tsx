import { Coffee, LogIn, LogOut, Pause } from "lucide-react";
import { useMemo, useState } from "react";
import { useAuth } from "../../auth/auth-context";
import { Avatar } from "../../components/ui/avatar";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Input, Select, Textarea } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { PageTabs } from "../../components/ui/page-tabs";
import { Table, THead, Td, Th } from "../../components/ui/table";
import { formatDuration } from "../../lib/format";
import { isManager } from "../../lib/schedule";
import { cn } from "../../lib/cn";
import {
  allowedEvents,
  CLOCK_EVENT_TYPES,
  clockStateFromSession,
  formatInTimeZone,
  formatTimeInZone,
  groupPunchRows,
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
      return "Working / Clocked in";
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

function punchCell(iso: string | null, timeZone: string): string {
  return iso ? formatTimeInZone(iso, timeZone) : "—";
}

function eventIcon(event: ClockEventType) {
  switch (event) {
    case "clock_in":
      return LogIn;
    case "clock_out":
      return LogOut;
    case "break_start":
      return Coffee;
    case "break_end":
      return Pause;
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

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "clock", label: "Clock" },
    { id: "working", label: "Who’s working" },
  ];
  if (manager) {
    tabs.push(
      { id: "attendance", label: "Attendance" },
      { id: "activity", label: "Activity" },
      { id: "exceptions", label: "Exceptions" },
    );
  }
  if (owner) {
    tabs.push({ id: "settings", label: "Settings" });
  }

  return (
    <div className="space-y-4">
      <PageTabs items={tabs} value={tab} onChange={setTab} />

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
  const rows = groupPunchRows(eventsQuery.data ?? []);
  const clockedInAt = sessionQuery.data?.clocked_in_at;

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
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "mt-1 size-2.5 rounded-full",
                state === "working" ? "bg-ok" : state === "on_break" ? "bg-warn" : "bg-slate-300",
              )}
            />
            <div>
              <p className="text-lg font-semibold text-ink">{stateLabel(state)}</p>
              {clockedInAt ? (
                <p className="mt-1 text-sm text-muted">
                  Clocked in {formatTimeInZone(clockedInAt, timeZone)}
                  {sessionQuery.data?.break_started_at
                    ? ` · Break started ${formatTimeInZone(sessionQuery.data.break_started_at, timeZone)}`
                    : null}
                </p>
              ) : (
                <p className="mt-1 text-sm text-muted">Ready to clock in</p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {CLOCK_EVENT_TYPES.map((event) => {
              const enabled = actions.includes(event) && !punch.isPending && Boolean(me.data?.active);
              const Icon = eventIcon(event);
              return (
                <Button
                  key={event}
                  variant={
                    (event === "clock_in" && state === "off_clock") ||
                    (event === "clock_out" && state === "working")
                      ? "primary"
                      : "ghost"
                  }
                  disabled={!enabled}
                  onClick={() => punch.mutate({ event_type: event })}
                >
                  {Icon ? <Icon className="size-4" /> : null}
                  {punch.isPending && actions.includes(event) ? "Saving…" : actionLabel(event)}
                </Button>
              );
            })}
          </div>
        </div>
      </Card>

      <div>
        <h2 className="mb-3 font-semibold">Recent punches</h2>
        {eventsQuery.isLoading ? <p className="text-sm text-muted">Loading…</p> : null}
        {eventsQuery.error ? <p className="text-sm text-danger">{eventsQuery.error.message}</p> : null}
        <Table>
          <THead>
            <tr>
              <Th>Date</Th>
              <Th>Clock in</Th>
              <Th>Start break</Th>
              <Th>End break</Th>
              <Th>Clock out</Th>
            </tr>
          </THead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <Td>
                  {new Date(
                    row.clockIn ?? row.breakStart ?? row.breakEnd ?? row.clockOut ?? 0,
                  ).toLocaleDateString(undefined, { timeZone, month: "short", day: "numeric" })}
                </Td>
                <Td>{punchCell(row.clockIn, timeZone)}</Td>
                <Td>{punchCell(row.breakStart, timeZone)}</Td>
                <Td>{punchCell(row.breakEnd, timeZone)}</Td>
                <Td>{punchCell(row.clockOut, timeZone)}</Td>
              </tr>
            ))}
            {rows.length === 0 && !eventsQuery.isLoading ? (
              <tr>
                <Td colSpan={5} className="py-8 text-center text-muted">
                  No clock events yet.
                </Td>
              </tr>
            ) : null}
          </tbody>
        </Table>
      </div>
    </div>
  );
}

function WhosWorkingPanel({ manager, timeZone }: { manager: boolean; timeZone: string }) {
  const working = useWhosWorking();
  const forceOut = useManagerForceClockOut();
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState<string>("");
  const rows = working.data ?? [];

  return (
    <div className="space-y-4">
      {working.error ? <p className="text-sm text-danger">{working.error.message}</p> : null}
      {forceOut.error ? <p className="text-sm text-danger">{forceOut.error.message}</p> : null}
      <Card>
        <h2 className="font-semibold">Who’s working</h2>
        <p className="mt-1 text-sm text-muted">View staff who are currently working or on break.</p>
        {working.isLoading ? <p className="mt-4 text-sm text-muted">Loading…</p> : null}
        {rows.length === 0 && !working.isLoading ? (
          <p className="mt-6 text-center text-sm text-muted">
            No one is working right now. When staff clock in, they’ll appear here.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {rows.map((row) => (
              <li key={row.employee_id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3">
                  <Avatar name={row.full_name} />
                  <div>
                    <p className="font-medium">{row.full_name}</p>
                    <Badge tone={row.state === "working" ? "ok" : "warn"} dot>
                      {row.state === "working" ? "Working" : "On break"}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-sm text-muted">
                  {row.clocked_in_at ? `Since ${formatTimeInZone(row.clocked_in_at, timeZone)}` : null}
                  {manager ? (
                    <button
                      type="button"
                      className="font-medium text-wine hover:underline"
                      onClick={() => setSelected(row.employee_id)}
                    >
                      Force out
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
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
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
        <div className="mt-4 flex justify-end">
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

      <div>
        <h2 className="mb-1 font-semibold">Derived time entries</h2>
        <p className="mb-3 text-sm text-muted">Auto-calculated from clock events</p>
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
                <Td>
                  <div className="flex items-center gap-2">
                    <Avatar name={entry.employees?.full_name ?? "Staff"} className="size-8" />
                    {entry.employees?.full_name ?? entry.employee_id.slice(0, 8)}
                  </div>
                </Td>
                <Td>{formatInTimeZone(entry.started_at, timeZone)}</Td>
                <Td>{formatInTimeZone(entry.ended_at, timeZone)}</Td>
                <Td>{formatDuration(entry.worked_seconds)}</Td>
                <Td>{formatDuration(entry.unpaid_break_seconds)}</Td>
                <Td>
                  <Badge tone={entry.status === "exception" ? "warn" : "neutral"} dot>
                    {entry.status}
                  </Badge>
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
      </div>
    </div>
  );
}

function ActivityPanel({ timeZone }: { timeZone: string }) {
  const events = useOrgClockEvents();
  return (
    <div>
      {events.error ? <p className="mb-3 text-sm text-danger">{events.error.message}</p> : null}
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
              <Td>
                <div className="flex items-center gap-2">
                  <Avatar name={event.employees?.full_name ?? "Staff"} className="size-8" />
                  {event.employees?.full_name ?? event.employee_id.slice(0, 8)}
                </div>
              </Td>
              <Td>{actionLabel(event.event_type)}</Td>
              <Td className="capitalize">{event.actor_type}</Td>
              <Td className="capitalize">{event.source}</Td>
            </tr>
          ))}
          {(events.data ?? []).length === 0 ? (
            <tr>
              <Td colSpan={5} className="py-8 text-center text-muted">
                No clock activity yet.
              </Td>
            </tr>
          ) : null}
        </tbody>
      </Table>
    </div>
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
        <p className="mt-1 text-xs text-muted">Flags missed-out / missed-in. Does not invent a clock-out.</p>
      </div>
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
                <Badge tone={row.status === "open" ? "warn" : "ok"} dot>
                  {row.status}
                </Badge>
              </Td>
              <Td>
                {row.status === "open" ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-xs font-medium text-wine hover:underline"
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
          {(exceptions.data ?? []).length === 0 ? (
            <tr>
              <Td colSpan={5} className="py-8 text-center text-muted">
                No exceptions.
              </Td>
            </tr>
          ) : null}
        </tbody>
      </Table>
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
