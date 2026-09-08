import type { MembershipRole, Shift, ShiftStatus, Station } from "./types";

export function isManager(role: MembershipRole | null): boolean {
  return role === "owner" || role === "manager";
}

export function stationLabel(station: Station): string {
  switch (station) {
    case "Server":
    case "Cook":
    case "Bartender":
    case "Host":
    case "Dish":
    case "Manager":
    case "Other":
      return station;
    default: {
      const exhaustive: never = station;
      return exhaustive;
    }
  }
}

export function statusLabel(status: ShiftStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "published":
      return "Published";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export function weekStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function eachDayOfWeek(start: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart(start), i));
}

export function weekEnd(start: Date): Date {
  const end = addDays(weekStart(start), 7);
  end.setMilliseconds(-1);
  return end;
}

export function hoursBetween(startsAt: string | Date, endsAt: string | Date): number {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  return Math.max(0, (end - start) / 3_600_000);
}

export function shiftsOverlap(
  a: Pick<Shift, "starts_at" | "ends_at">,
  b: Pick<Shift, "starts_at" | "ends_at">,
): boolean {
  const aStart = new Date(a.starts_at).getTime();
  const aEnd = new Date(a.ends_at).getTime();
  const bStart = new Date(b.starts_at).getTime();
  const bEnd = new Date(b.ends_at).getTime();
  return aStart < bEnd && bStart < aEnd;
}

export function employeeHasOverlap(
  shifts: Array<Pick<Shift, "id" | "employee_id" | "starts_at" | "ends_at">>,
  candidate: Pick<Shift, "id" | "employee_id" | "starts_at" | "ends_at">,
): boolean {
  if (!candidate.employee_id) return false;
  return shifts.some(
    (shift) =>
      shift.id !== candidate.id &&
      shift.employee_id === candidate.employee_id &&
      shiftsOverlap(shift, candidate),
  );
}

export function employeeWeekHours(
  shifts: Array<Pick<Shift, "employee_id" | "starts_at" | "ends_at">>,
  employeeId: string,
): number {
  return shifts
    .filter((shift) => shift.employee_id === employeeId)
    .reduce((sum, shift) => sum + hoursBetween(shift.starts_at, shift.ends_at), 0);
}

export function filterShiftsForWeek<T extends Pick<Shift, "starts_at">>(
  shifts: T[],
  week: Date,
): T[] {
  const start = weekStart(week).getTime();
  const end = addDays(weekStart(week), 7).getTime();
  return shifts.filter((shift) => {
    const t = new Date(shift.starts_at).getTime();
    return t >= start && t < end;
  });
}

export function visibleShiftsForRole<T extends Pick<Shift, "status" | "employee_id">>(
  shifts: T[],
  role: MembershipRole | null,
  myEmployeeId: string | null,
): T[] {
  if (isManager(role)) return shifts;
  return shifts.filter((shift) => shift.status === "published" && shift.employee_id === myEmployeeId);
}

export function sameDay(iso: string, day: Date): boolean {
  const d = new Date(iso);
  return (
    d.getFullYear() === day.getFullYear() &&
    d.getMonth() === day.getMonth() &&
    d.getDate() === day.getDate()
  );
}

export function formatTimeRange(startsAt: string, endsAt: string): string {
  const opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  return `${new Date(startsAt).toLocaleTimeString([], opts)}–${new Date(endsAt).toLocaleTimeString([], opts)}`;
}

export function formatWeekLabel(start: Date): string {
  const end = addDays(weekStart(start), 6);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${weekStart(start).toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, {
    ...opts,
    year: "numeric",
  })}`;
}

export function atTimeOnDay(day: Date, hours: number, minutes: number): Date {
  const d = new Date(day);
  d.setHours(hours, minutes, 0, 0);
  return d;
}
