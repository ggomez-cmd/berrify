import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { useAuth } from "../../auth/auth-context";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import {
  addDays,
  employeeHasOverlap,
  employeeWeekHours,
  eachDayOfWeek,
  filterShiftsForWeek,
  formatTimeRange,
  formatWeekLabel,
  isManager,
  sameDay,
  statusLabel,
  weekStart,
  atTimeOnDay,
} from "../../lib/schedule";
import type { Employee, Shift, ShiftWithEmployee } from "../../lib/types";
import { useEmployees, useMyEmployee } from "../employees/hooks";
import { ShiftDialog } from "./ShiftDialog";
import { usePublishWeek, useShifts } from "./hooks";

type DraftTarget = {
  shift: Shift | null;
  starts?: string;
  ends?: string;
  employeeId?: string | null;
};

export function SchedulePage() {
  const { role } = useAuth();
  const manager = isManager(role);
  const { data: employees = [] } = useEmployees();
  const { data: myEmployee } = useMyEmployee();
  const { data: shifts = [], isLoading, error } = useShifts();
  const publish = usePublishWeek();
  const [cursor, setCursor] = useState(() => weekStart(new Date()));
  const [dialog, setDialog] = useState<DraftTarget | null>(null);

  const weekDays = useMemo(() => eachDayOfWeek(cursor), [cursor]);
  const weekShifts = useMemo(() => filterShiftsForWeek(shifts, cursor), [shifts, cursor]);
  const activeEmployees = useMemo(() => employees.filter((e) => e.active), [employees]);
  const drafts = weekShifts.filter((s) => s.status === "draft");
  const overlapCount = weekShifts.filter((s) => employeeHasOverlap(weekShifts, s)).length;

  if (!manager) {
    return (
      <StaffSchedule
        weekDays={weekDays}
        weekShifts={weekShifts}
        myEmployeeId={myEmployee?.id ?? null}
        cursor={cursor}
        setCursor={setCursor}
        isLoading={isLoading}
        error={error?.message ?? null}
      />
    );
  }

  return (
    <div className="space-y-4">
      <WeekPager cursor={cursor} setCursor={setCursor} />

      {overlapCount > 0 ? (
        <p className="rounded-xl border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn">
          {overlapCount} overlapping shift{overlapCount === 1 ? "" : "s"} this week.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          onClick={() =>
            setDialog({
              shift: null,
              starts: atTimeOnDay(weekDays[0], 16, 0).toISOString(),
              ends: atTimeOnDay(weekDays[0], 22, 0).toISOString(),
            })
          }
        >
          Add shift
        </Button>
        <Button
          disabled={drafts.length === 0 || publish.isPending}
          onClick={() => void publish.mutateAsync(drafts.map((s) => s.id))}
        >
          {publish.isPending ? "Publishing…" : `Publish week (${drafts.length} draft)`}
        </Button>
      </div>

      {error ? <p className="text-sm text-danger">{error.message}</p> : null}
      {isLoading ? <p className="text-sm text-muted">Loading schedule…</p> : null}

      <div className="overflow-x-auto rounded-2xl border border-line bg-white shadow-sm">
        <table className="w-full min-w-[960px] border-collapse text-sm">
          <thead className="bg-navy text-xs uppercase tracking-wide text-white">
            <tr>
              <th className="w-40 px-3 py-2.5 text-left font-medium">Employee</th>
              {weekDays.map((day) => (
                <th key={day.toISOString()} className="px-2 py-2.5 text-left font-medium">
                  <div>{day.toLocaleDateString(undefined, { weekday: "short" })}</div>
                  <div className="font-normal normal-case text-white/70">
                    {day.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activeEmployees.map((employee) => (
              <EmployeeRow
                key={employee.id}
                employee={employee}
                weekDays={weekDays}
                shifts={weekShifts}
                onCreate={(day) =>
                  setDialog({
                    shift: null,
                    employeeId: employee.id,
                    starts: atTimeOnDay(day, 16, 0).toISOString(),
                    ends: atTimeOnDay(day, 22, 0).toISOString(),
                  })
                }
                onEdit={(shift) => setDialog({ shift })}
              />
            ))}
            <EmployeeRow
              employee={null}
              weekDays={weekDays}
              shifts={weekShifts}
              onCreate={(day) =>
                setDialog({
                  shift: null,
                  employeeId: null,
                  starts: atTimeOnDay(day, 17, 0).toISOString(),
                  ends: atTimeOnDay(day, 23, 0).toISOString(),
                })
              }
              onEdit={(shift) => setDialog({ shift })}
            />
          </tbody>
        </table>
      </div>

      <Card>
        <h2 className="mb-3 font-semibold">Hours this week</h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {activeEmployees.map((employee) => (
            <li key={employee.id} className="flex justify-between text-sm">
              <span>{employee.full_name}</span>
              <span className="text-muted">{employeeWeekHours(weekShifts, employee.id).toFixed(1)} h</span>
            </li>
          ))}
        </ul>
      </Card>

      <ShiftDialog
        open={Boolean(dialog)}
        onOpenChange={(next) => {
          if (!next) setDialog(null);
        }}
        shift={dialog?.shift ?? null}
        employees={employees}
        existing={weekShifts}
        defaultStarts={dialog?.starts}
        defaultEnds={dialog?.ends}
        defaultEmployeeId={dialog?.employeeId}
      />
    </div>
  );
}

function WeekPager({
  cursor,
  setCursor,
}: {
  cursor: Date;
  setCursor: (d: Date) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="ghost" onClick={() => setCursor(addDays(cursor, -7))} aria-label="Previous week">
        <ChevronLeft className="size-4" />
      </Button>
      <p className="min-w-48 text-center text-sm font-medium">{formatWeekLabel(cursor)}</p>
      <Button variant="ghost" onClick={() => setCursor(addDays(cursor, 7))} aria-label="Next week">
        <ChevronRight className="size-4" />
      </Button>
      <Button variant="subtle" onClick={() => setCursor(weekStart(new Date()))}>
        This week
      </Button>
    </div>
  );
}

function EmployeeRow({
  employee,
  weekDays,
  shifts,
  onCreate,
  onEdit,
}: {
  employee: Employee | null;
  weekDays: Date[];
  shifts: ShiftWithEmployee[];
  onCreate: (day: Date) => void;
  onEdit: (shift: Shift) => void;
}) {
  const name = employee?.full_name ?? "Open shifts";
  return (
    <tr className="align-top">
      <td className="border-t border-line px-3 py-2">
        <div className="font-medium">{name}</div>
        <div className="text-xs text-muted">{employee?.position ?? "Unassigned"}</div>
      </td>
      {weekDays.map((day) => {
        const cell = shifts.filter((s) => {
          const matchEmployee = employee ? s.employee_id === employee.id : s.employee_id === null;
          return matchEmployee && sameDay(s.starts_at, day);
        });
        return (
          <td key={day.toISOString()} className="border-t border-line px-1.5 py-2">
            <div className="flex min-h-16 flex-col gap-1">
              {cell.map((shift) => (
                <button
                  key={shift.id}
                  type="button"
                  onClick={() => onEdit(shift)}
                  className="rounded-lg border border-line bg-paper px-2 py-1 text-left hover:border-wine"
                >
                  <div className="text-xs font-medium">{formatTimeRange(shift.starts_at, shift.ends_at)}</div>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[11px] text-muted">{shift.position}</span>
                    <Badge tone={shift.status === "published" ? "ok" : "warn"}>{statusLabel(shift.status)}</Badge>
                  </div>
                </button>
              ))}
              <button
                type="button"
                onClick={() => onCreate(day)}
                className="rounded-lg px-2 py-1 text-left text-[11px] text-muted hover:bg-paper hover:text-ink"
              >
                + Add
              </button>
            </div>
          </td>
        );
      })}
    </tr>
  );
}

function StaffSchedule({
  weekDays,
  weekShifts,
  myEmployeeId,
  cursor,
  setCursor,
  isLoading,
  error,
}: {
  weekDays: Date[];
  weekShifts: ShiftWithEmployee[];
  myEmployeeId: string | null;
  cursor: Date;
  setCursor: (d: Date) => void;
  isLoading: boolean;
  error: string | null;
}) {
  const mine = weekShifts.filter((s) => s.status === "published" && s.employee_id === myEmployeeId);

  return (
    <div className="space-y-4">
      <WeekPager cursor={cursor} setCursor={setCursor} />
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {isLoading ? <p className="text-sm text-muted">Loading your shifts…</p> : null}
      {weekDays.map((day) => {
        const dayMine = mine.filter((s) => sameDay(s.starts_at, day));
        const others = weekShifts.filter(
          (s) =>
            s.status === "published" &&
            s.employee_id !== myEmployeeId &&
            sameDay(s.starts_at, day) &&
            dayMine.length > 0,
        );
        return (
          <Card key={day.toISOString()}>
            <h2 className="mb-2 font-semibold">
              {day.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
            </h2>
            {dayMine.length === 0 ? (
              <p className="text-sm text-muted">No published shifts for you.</p>
            ) : (
              <ul className="space-y-2">
                {dayMine.map((s) => (
                  <li key={s.id} className="text-sm">
                    <span className="font-medium">{formatTimeRange(s.starts_at, s.ends_at)}</span>
                    <span className="ml-2 text-muted">{s.position}</span>
                    {s.note ? <span className="ml-2 text-muted">· {s.note}</span> : null}
                  </li>
                ))}
              </ul>
            )}
            {others.length > 0 ? (
              <p className="mt-3 text-xs text-muted">
                Also on: {others.map((s) => s.employees?.full_name ?? "Open").join(", ")}
              </p>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
