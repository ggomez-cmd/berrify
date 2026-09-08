import { addDays, weekStart } from "./schedule";
import type { ShiftStatus, Station } from "./types";

export const DEMO_FILL_NOTE = "[demo-fill]";

export type DemoShiftDraft = {
  email: string | null;
  position: Station;
  startsAt: string;
  endsAt: string;
  status: ShiftStatus;
  note: string;
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Puerto Rico is AST year-round (UTC−4). */
export function astStamp(year: number, month: number, day: number, hour: number, minute = 0): string {
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00-04:00`;
}

function dayTime(sunday: Date, offset: number, hour: number, minute = 0): string {
  const day = addDays(sunday, offset);
  return astStamp(day.getFullYear(), day.getMonth() + 1, day.getDate(), hour, minute);
}

export function demoWeekShifts(around = new Date()): DemoShiftDraft[] {
  const sunday = weekStart(around);
  const note = (label: string) => `${DEMO_FILL_NOTE} ${label}`;

  return [
    { email: "server@berrify.local", position: "Server", startsAt: dayTime(sunday, 0, 16), endsAt: dayTime(sunday, 0, 22), status: "published", note: note("Sunday dinner") },
    { email: "cook@berrify.local", position: "Cook", startsAt: dayTime(sunday, 0, 15), endsAt: dayTime(sunday, 0, 23), status: "published", note: note("Sunday line") },
    { email: "server@berrify.local", position: "Server", startsAt: dayTime(sunday, 1, 11), endsAt: dayTime(sunday, 1, 16), status: "published", note: note("Monday lunch") },
    { email: "server@berrify.local", position: "Server", startsAt: dayTime(sunday, 1, 16), endsAt: dayTime(sunday, 1, 22), status: "published", note: note("Monday dinner") },
    { email: "cook@berrify.local", position: "Cook", startsAt: dayTime(sunday, 1, 15), endsAt: dayTime(sunday, 1, 23), status: "published", note: note("Monday line") },
    { email: "host@pacifico.example", position: "Host", startsAt: dayTime(sunday, 1, 16), endsAt: dayTime(sunday, 1, 21), status: "published", note: note("Monday host") },
    { email: "server@berrify.local", position: "Server", startsAt: dayTime(sunday, 2, 16), endsAt: dayTime(sunday, 2, 22), status: "published", note: note("Tuesday dinner") },
    { email: "cook@berrify.local", position: "Cook", startsAt: dayTime(sunday, 2, 15), endsAt: dayTime(sunday, 2, 23), status: "published", note: note("Tuesday line") },
    { email: "host@pacifico.example", position: "Host", startsAt: dayTime(sunday, 2, 16), endsAt: dayTime(sunday, 2, 21), status: "published", note: note("Tuesday host") },
    { email: "bar@pacifico.example", position: "Bartender", startsAt: dayTime(sunday, 2, 16), endsAt: dayTime(sunday, 2, 23), status: "published", note: note("Tuesday bar") },
    { email: "server@berrify.local", position: "Server", startsAt: dayTime(sunday, 3, 16), endsAt: dayTime(sunday, 3, 22), status: "published", note: note("Wednesday dinner") },
    { email: "cook@berrify.local", position: "Cook", startsAt: dayTime(sunday, 3, 14), endsAt: dayTime(sunday, 3, 22), status: "published", note: note("Wednesday line") },
    { email: "dish@pacifico.example", position: "Dish", startsAt: dayTime(sunday, 3, 16), endsAt: dayTime(sunday, 3, 23), status: "published", note: note("Wednesday dish") },
    { email: "server@berrify.local", position: "Server", startsAt: dayTime(sunday, 4, 16), endsAt: dayTime(sunday, 4, 22), status: "published", note: note("Thursday dinner") },
    { email: "cook@berrify.local", position: "Cook", startsAt: dayTime(sunday, 4, 14), endsAt: dayTime(sunday, 4, 22), status: "published", note: note("Thursday line") },
    { email: "bar@pacifico.example", position: "Bartender", startsAt: dayTime(sunday, 4, 17), endsAt: dayTime(sunday, 4, 23), status: "published", note: note("Thursday bar") },
    { email: "server@berrify.local", position: "Server", startsAt: dayTime(sunday, 5, 16), endsAt: dayTime(sunday, 5, 22), status: "published", note: note("Friday dinner") },
    { email: "cook@berrify.local", position: "Cook", startsAt: dayTime(sunday, 5, 14), endsAt: dayTime(sunday, 5, 23), status: "published", note: note("Friday line") },
    { email: "bar@pacifico.example", position: "Bartender", startsAt: dayTime(sunday, 5, 16), endsAt: dayTime(sunday, 6, 0), status: "published", note: note("Friday bar") },
    { email: "dish@pacifico.example", position: "Dish", startsAt: dayTime(sunday, 5, 16), endsAt: dayTime(sunday, 5, 23), status: "published", note: note("Friday dish") },
    { email: null, position: "Server", startsAt: dayTime(sunday, 5, 17), endsAt: dayTime(sunday, 5, 23), status: "published", note: note("Friday open") },
    { email: "server@berrify.local", position: "Server", startsAt: dayTime(sunday, 6, 16), endsAt: dayTime(sunday, 6, 22), status: "draft", note: note("Saturday dinner draft") },
    { email: "cook@berrify.local", position: "Cook", startsAt: dayTime(sunday, 6, 14), endsAt: dayTime(sunday, 6, 22), status: "draft", note: note("Saturday line draft") },
    { email: "host@pacifico.example", position: "Host", startsAt: dayTime(sunday, 6, 16), endsAt: dayTime(sunday, 6, 21), status: "draft", note: note("Saturday host draft") },
  ];
}
