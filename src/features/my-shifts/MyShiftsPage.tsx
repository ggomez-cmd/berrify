import { useState } from "react";
import { useAuth } from "../../auth/auth-context";
import { Badge } from "../../components/ui/badge";
import { Card } from "../../components/ui/card";
import { formatWorked, summarizeShifts, weekRangeInZone } from "../../lib/my-shifts";
import { weekStart } from "../../lib/schedule";
import { formatTimeInZone } from "../../lib/time-clock";
import { useMyEmployee } from "../employees/hooks";
import { useRestaurants } from "../invoices/hooks";
import { WeekPager } from "../schedule/WeekPager";
import { useMyClockSession, useMyTimeEntries } from "../time-clock/hooks";

export function MyShiftsPage() {
  const { org } = useAuth();
  const timeZone = org?.timezone ?? "America/Puerto_Rico";
  const [cursor, setCursor] = useState(() => weekStart(new Date()));
  const { data: me, isLoading: meLoading } = useMyEmployee();
  // Punches happen on the tablet, so keep this phone's status fresh.
  const { data: session } = useMyClockSession({ refetchInterval: 60_000 });
  const { data: restaurants = [] } = useRestaurants();
  const { from, to } = weekRangeInZone(weekStart(cursor), timeZone);
  const entriesQuery = useMyTimeEntries(me?.id ?? null, from, to);
  const entries = entriesQuery.data ?? [];
  const summary = summarizeShifts(entries);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-semibold">
              {session?.state === "on_break"
                ? `On break since ${formatTimeInZone(session.break_started_at ?? session.clocked_in_at, timeZone)}`
                : session
                  ? `On the clock since ${formatTimeInZone(session.clocked_in_at, timeZone)}`
                  : "Off the clock"}
            </p>
            <p className="text-sm text-muted">Clock in and out at the kiosk.</p>
          </div>
          <Badge tone={session ? "ok" : "neutral"} dot>
            {session ? "Working" : "Off"}
          </Badge>
        </div>
      </Card>

      <WeekPager cursor={cursor} setCursor={setCursor} />

      {!meLoading && !me ? (
        <p className="text-sm text-muted">Your login is not linked to the roster yet. Ask your manager.</p>
      ) : null}
      {entriesQuery.error ? <p className="text-sm text-danger">{entriesQuery.error.message}</p> : null}
      {entriesQuery.isLoading ? <p className="text-sm text-muted">Loading your shifts…</p> : null}

      {me && !entriesQuery.isLoading && !entriesQuery.error ? (
        entries.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">No completed shifts this week.</p>
          </Card>
        ) : (
          <>
            <p className="text-sm text-muted">
              {summary.count} {summary.count === 1 ? "shift" : "shifts"} · {formatWorked(summary.workedSeconds)} worked
            </p>
            <ul className="space-y-2">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <Card>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">
                          {new Date(entry.started_at).toLocaleDateString(undefined, {
                            timeZone,
                            weekday: "long",
                            month: "short",
                            day: "numeric",
                          })}
                        </p>
                        <p className="text-sm text-muted">
                          {[restaurants.find((r) => r.id === entry.restaurant_id)?.name, entry.position]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">{formatWorked(entry.worked_seconds)}</p>
                        {entry.status === "exception" ? (
                          <Badge tone="warn">Under review</Badge>
                        ) : null}
                      </div>
                    </div>
                    <p className="mt-2 text-sm">
                      <span className="inline-flex rounded-xl bg-wine px-2.5 py-1 text-xs font-medium text-white">
                        {formatTimeInZone(entry.started_at, timeZone)} – {formatTimeInZone(entry.ended_at, timeZone)}
                      </span>
                      {entry.unpaid_break_seconds > 0 ? (
                        <span className="ml-2 text-muted">{formatWorked(entry.unpaid_break_seconds)} unpaid break</span>
                      ) : null}
                    </p>
                  </Card>
                </li>
              ))}
            </ul>
          </>
        )
      ) : null}
    </div>
  );
}
