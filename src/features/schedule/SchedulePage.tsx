import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { useAuth } from "../../auth/auth-context";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { PageTabs } from "../../components/ui/page-tabs";
import {
  addDays,
  ALL_RESTAURANTS,
  employeesForRestaurant,
  employeeHasOverlap,
  employeeWeekHours,
  eachDayOfWeek,
  filterShiftsForWeek,
  formatTimeRange,
  formatWeekLabel,
  isManager,
  sameDay,
  shiftsForRestaurant,
  statusLabel,
  weekStart,
  atTimeOnDay,
} from "../../lib/schedule";
import { cn } from "../../lib/cn";
import type { Employee, Restaurant, Shift, ShiftWithEmployee } from "../../lib/types";
import { useEmployees, useMyEmployee } from "../employees/hooks";
import { useRestaurants } from "../invoices/hooks";
import { ShiftDialog } from "./ShiftDialog";
import { usePublishWeek, useShifts } from "./hooks";

const RESTAURANT_KEY = "berrify.schedule.restaurant";

function readSavedRestaurant(): string | null {
  try {
    return window.localStorage.getItem(RESTAURANT_KEY);
  } catch {
    return null;
  }
}

function saveRestaurant(id: string) {
  try {
    window.localStorage.setItem(RESTAURANT_KEY, id);
  } catch {
    // Remembering the tab is a convenience only.
  }
}

type DraftTarget = {
  shift: Shift | null;
  starts?: string;
  ends?: string;
  employeeId?: string | null;
  lockDay?: boolean;
};

export function SchedulePage() {
  const { role } = useAuth();
  const manager = isManager(role);
  const employeesQuery = useEmployees();
  const employees = useMemo(() => employeesQuery.data ?? [], [employeesQuery.data]);
  const { data: myEmployee } = useMyEmployee();
  const { data: shifts = [], isLoading, error } = useShifts();
  const restaurantsQuery = useRestaurants();
  const restaurants = useMemo(() => restaurantsQuery.data ?? [], [restaurantsQuery.data]);
  const [publishNotice, setPublishNotice] = useState<string | null>(null);
  const publish = usePublishWeek();
  const [pickedRestaurant, setPickedRestaurant] = useState<string | null>(readSavedRestaurant);
  const [cursor, setCursor] = useState(() => weekStart(new Date()));
  const [dialog, setDialog] = useState<DraftTarget | null>(null);

  const weekDays = useMemo(() => eachDayOfWeek(cursor), [cursor]);
  const weekShifts = useMemo(() => filterShiftsForWeek(shifts, cursor), [shifts, cursor]);
  // Until restaurants and the roster load, the board can't tell which shifts belong where.
  const boardReady = restaurantsQuery.isSuccess && employeesQuery.isSuccess;
  const boardError = restaurantsQuery.error ?? employeesQuery.error;
  const restaurantId =
    pickedRestaurant && (pickedRestaurant === ALL_RESTAURANTS || restaurants.some((r) => r.id === pickedRestaurant))
      ? pickedRestaurant
      : (restaurants[0]?.id ?? ALL_RESTAURANTS);
  const restaurant = restaurants.find((r) => r.id === restaurantId) ?? null;
  const boardShifts = useMemo(
    () => shiftsForRestaurant(weekShifts, restaurantId),
    [weekShifts, restaurantId],
  );
  // Home crew, plus anyone from another restaurant who is covering a shift here this week.
  const boardEmployees = useMemo(() => {
    const crew = new Set(employeesForRestaurant(employees.filter((e) => e.active), restaurantId).map((e) => e.id));
    for (const s of boardShifts) if (s.employee_id) crew.add(s.employee_id);
    return employees.filter((e) => crew.has(e.id));
  }, [employees, boardShifts, restaurantId]);
  const drafts = boardShifts.filter((s) => s.status === "draft");
  const overlapCount = boardShifts.filter((s) => employeeHasOverlap(weekShifts, s)).length;

  if (!manager) {
    return (
      <StaffSchedule
        weekDays={weekDays}
        weekShifts={weekShifts}
        restaurants={restaurants}
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
      {restaurants.length > 0 ? (
        <PageTabs
          items={[
            ...restaurants.map((r) => ({ id: r.id, label: r.name })),
            { id: ALL_RESTAURANTS, label: "All restaurants" },
          ]}
          value={restaurantId}
          onChange={(id) => {
            setPickedRestaurant(id);
            saveRestaurant(id);
          }}
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <WeekPager cursor={cursor} setCursor={setCursor} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            disabled={!boardReady}
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
            disabled={!boardReady || drafts.length === 0 || publish.isPending}
            onClick={() => {
              setPublishNotice(null);
              void publish
                .mutateAsync({
                  ids: drafts.map((s) => s.id),
                  restaurantId: restaurant ? restaurant.id : null,
                })
                .then((count) => {
                  const skipped = drafts.length - count;
                  if (skipped > 0) {
                    setPublishNotice(
                      `${skipped} draft${skipped === 1 ? "" : "s"} changed since the board loaded and ${skipped === 1 ? "was" : "were"} not published. The board has been refreshed.`,
                    );
                  }
                });
            }}
          >
            {publish.isPending
              ? "Publishing…"
              : `Publish ${restaurant ? restaurant.name : "week"} (${drafts.length} draft)`}
          </Button>
        </div>
      </div>

      {overlapCount > 0 ? (
        <p className="rounded-xl border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn">
          {overlapCount} overlapping shift{overlapCount === 1 ? "" : "s"} this week
          {restaurant ? ` at ${restaurant.name}` : ""}.
        </p>
      ) : null}

      {publishNotice ? (
        <p className="rounded-xl border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn" role="status">
          {publishNotice}
        </p>
      ) : null}
      {publish.error ? <p className="text-sm text-danger">{publish.error.message}</p> : null}
      {boardError ? <p className="text-sm text-danger">{boardError.message}</p> : null}
      {error ? <p className="text-sm text-danger">{error.message}</p> : null}
      {isLoading ? <p className="text-sm text-muted">Loading schedule…</p> : null}

      <div className="overflow-x-auto rounded-2xl border border-line bg-white shadow-sm">
        <table className="w-full min-w-[1080px] border-collapse text-sm">
          <thead className="bg-[#f8f8fa] text-xs font-medium uppercase tracking-wide text-muted">
            <tr>
              <th className="sticky left-0 z-10 w-44 bg-[#f8f8fa] px-4 py-3 text-left shadow-[4px_0_8px_-6px_rgba(15,23,42,0.25)]">Staff</th>
              {weekDays.map((day) => (
                <th key={day.toISOString()} className="px-2 py-3 text-left">
                  <div className="font-semibold normal-case text-ink">
                    {day.toLocaleDateString(undefined, { weekday: "short" })}
                  </div>
                  <div className="font-normal normal-case text-muted">
                    {day.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </div>
                </th>
              ))}
              <th className="w-20 px-3 py-3 text-right">Hours</th>
            </tr>
          </thead>
          <tbody>
            {boardEmployees.length === 0 ? (
              <tr>
                <td colSpan={9} className="border-t border-line py-10 text-center text-muted">
                  No employees at {restaurant?.name ?? "this restaurant"} yet. Set their restaurant on the Employees page.
                </td>
              </tr>
            ) : null}
            {boardEmployees.map((employee) => (
              <EmployeeRow
                key={employee.id}
                employee={employee}
                weekDays={weekDays}
                shifts={boardShifts}
                hours={employeeWeekHours(boardShifts, employee.id)}
                canAdd={boardReady && employee.active}
                onCreate={(day) =>
                  setDialog({
                    shift: null,
                    lockDay: true,
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
              shifts={boardShifts}
              hours={null}
              canAdd={boardReady}
              onCreate={(day) =>
                setDialog({
                  shift: null,
                  lockDay: true,
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
        lockDay={dialog?.lockDay ?? false}
        restaurants={restaurants}
        restaurantId={restaurantId}
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
    <div className="flex flex-wrap items-center gap-1">
      <Button variant="ghost" className="px-2" onClick={() => setCursor(addDays(cursor, -7))} aria-label="Previous week">
        <ChevronLeft className="size-4" />
      </Button>
      <Button variant="ghost" className="min-w-0 sm:min-w-48">
        <CalendarDays className="size-4" />
        {formatWeekLabel(cursor)}
      </Button>
      <Button variant="ghost" className="px-2" onClick={() => setCursor(addDays(cursor, 7))} aria-label="Next week">
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
  hours,
  canAdd,
  onCreate,
  onEdit,
}: {
  employee: Employee | null;
  weekDays: Date[];
  shifts: ShiftWithEmployee[];
  hours: number | null;
  canAdd: boolean;
  onCreate: (day: Date) => void;
  onEdit: (shift: Shift) => void;
}) {
  const name = employee?.full_name ?? "Open shifts";
  return (
    <tr className="align-top">
      <td className="sticky left-0 z-10 border-t border-line bg-white px-4 py-3 shadow-[4px_0_8px_-6px_rgba(15,23,42,0.25)]">
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
              {cell.length === 0 ? <span className="px-2 py-1 text-muted">—</span> : null}
              {cell.map((shift) => (
                <button
                  key={shift.id}
                  type="button"
                  onClick={() => onEdit(shift)}
                  className={cn(
                    "rounded-xl px-2 py-1.5 text-left",
                    shift.status === "published"
                      ? "bg-wine text-white"
                      : "bg-paper text-ink hover:border hover:border-line",
                  )}
                >
                  <div className="text-xs font-medium">{formatTimeRange(shift.starts_at, shift.ends_at)}</div>
                  <div className={cn("text-[11px]", shift.status === "published" ? "text-white/80" : "text-muted")}>
                    {statusLabel(shift.status)}
                  </div>
                </button>
              ))}
              {canAdd ? (
                <button
                  type="button"
                  onClick={() => onCreate(day)}
                  className="rounded-lg px-2 py-1 text-left text-[11px] text-muted hover:bg-paper hover:text-ink"
                >
                  + Add
                </button>
              ) : null}
            </div>
          </td>
        );
      })}
      <td className="border-t border-line px-3 py-3 text-right font-medium">
        {hours === null ? "—" : `${hours.toFixed(0)}h`}
      </td>
    </tr>
  );
}

function StaffSchedule({
  weekDays,
  weekShifts,
  restaurants,
  myEmployeeId,
  cursor,
  setCursor,
  isLoading,
  error,
}: {
  weekDays: Date[];
  weekShifts: ShiftWithEmployee[];
  restaurants: Array<Pick<Restaurant, "id" | "name">>;
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
        // Older shifts have no restaurant; staff can't see homes, so those stay unscoped.
        const myRestaurants = new Set(dayMine.map((s) => s.restaurant_id));
        const others = weekShifts.filter(
          (s) =>
            s.status === "published" &&
            s.employee_id !== myEmployeeId &&
            sameDay(s.starts_at, day) &&
            dayMine.length > 0 &&
            (myRestaurants.has(null) || s.restaurant_id === null || myRestaurants.has(s.restaurant_id)),
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
                    <span className="inline-flex rounded-xl bg-wine px-2.5 py-1 text-xs font-medium text-white">
                      {formatTimeRange(s.starts_at, s.ends_at)}
                    </span>
                    {s.restaurant_id ? (
                      <span className="ml-2 font-medium">
                        {restaurants.find((r) => r.id === s.restaurant_id)?.name}
                      </span>
                    ) : null}
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
