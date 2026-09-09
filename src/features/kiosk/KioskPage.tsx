import { Coffee, LogIn, LogOut, Pause } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { Avatar } from "../../components/ui/avatar";
import { Badge } from "../../components/ui/badge";
import { BrandMark } from "../../components/ui/brand-mark";
import { Button } from "../../components/ui/button";
import { MAX_CLOCK_PIN_LENGTH, isValidClockPin, pinError } from "../../lib/pin";
import { KIOSK_CONFIRM_MS, KIOSK_IDLE_MS } from "../../lib/kiosk";
import {
  CLOCK_EVENT_TYPES,
  allowedEvents,
  formatTimeInZone,
  type ClockEventType,
  type ClockState,
} from "../../lib/time-clock";
import { useKioskPunch, useKioskUnlock, type KioskUnlock } from "./hooks";
import { PinPad } from "./PinPad";

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

function stateTone(state: ClockState) {
  switch (state) {
    case "off_clock":
      return "neutral" as const;
    case "working":
      return "ok" as const;
    case "on_break":
      return "warn" as const;
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

function isPrimaryAction(event: ClockEventType, state: ClockState): boolean {
  return (
    (event === "clock_in" && state === "off_clock") ||
    (event === "clock_out" && state === "working") ||
    (event === "break_end" && state === "on_break")
  );
}

function useNow(timeZone: string): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now.toLocaleString(undefined, {
    timeZone,
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function KioskPage() {
  const { org } = useAuth();
  const timeZone = org?.timezone ?? "America/Puerto_Rico";
  const clockLabel = useNow(timeZone);
  const unlock = useKioskUnlock();
  const punch = useKioskPunch();
  const [pin, setPin] = useState("");
  const [session, setSession] = useState<KioskUnlock | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [activity, setActivity] = useState(0);

  const touch = useCallback(() => setActivity((n) => n + 1), []);

  const resetPad = useCallback(() => {
    setPin("");
    setSession(null);
    setError(null);
    setConfirm(null);
    unlock.reset();
    punch.reset();
  }, [punch, unlock]);

  useEffect(() => {
    if (!session && !confirm) return;
    const id = window.setTimeout(resetPad, KIOSK_IDLE_MS);
    return () => window.clearTimeout(id);
  }, [session, confirm, activity, resetPad]);

  const submitPin = async () => {
    const message = pinError(pin);
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    touch();
    try {
      const next = await unlock.mutateAsync(pin);
      setSession(next);
    } catch (err) {
      setPin("");
      setError(err instanceof Error ? err.message : "Invalid PIN");
    }
  };

  const onPunch = async (event: ClockEventType) => {
    if (!session || !isValidClockPin(pin)) return;
    setError(null);
    touch();
    try {
      await punch.mutateAsync({ pin, event_type: event });
      setConfirm(`${actionLabel(event)} · ${session.full_name}`);
      setSession(null);
      window.setTimeout(resetPad, KIOSK_CONFIRM_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not punch");
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-paper px-6 py-5 text-ink">
      <header className="flex items-center justify-between">
        <BrandMark className="h-8 w-[7.4rem] text-wine" />
        <Link to="/" className="text-sm font-medium text-muted hover:text-ink">
          Exit kiosk
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center py-6">
        {confirm ? (
          <div className="rounded-3xl border border-line bg-white px-8 py-16 text-center shadow-sm">
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted">Time clock</p>
            <p className="mt-4 text-2xl font-semibold">{confirm}</p>
            <p className="mt-2 text-sm text-muted">Returning to the PIN pad…</p>
          </div>
        ) : session ? (
          <KioskProfile
            session={session}
            timeZone={timeZone}
            pending={punch.isPending}
            error={error}
            onPunch={(event) => void onPunch(event)}
            onDone={() => {
              touch();
              resetPad();
            }}
          />
        ) : (
          <div className="rounded-3xl border border-line bg-white px-8 py-8 shadow-sm">
            <p className="text-center text-[11px] font-medium uppercase tracking-[0.2em] text-muted">
              Time clock
            </p>
            <p className="mt-3 text-center text-3xl font-semibold tracking-tight">{clockLabel}</p>
            <div className="mt-6 flex justify-center gap-3">
              {Array.from({ length: Math.max(4, pin.length) }, (_, index) => (
                <span
                  key={index}
                  className={`size-3.5 rounded-full ${index < pin.length ? "bg-wine" : "border-2 border-line"}`}
                />
              ))}
            </div>
            {error ? <p className="mt-4 text-center text-sm text-danger">{error}</p> : null}
            <div className="mx-auto mt-6 max-w-sm">
              <PinPad
                pin={pin}
                maxLength={MAX_CLOCK_PIN_LENGTH}
                disabled={unlock.isPending}
                onDigit={(digit) => {
                  setError(null);
                  touch();
                  setPin((current) =>
                    current.length >= MAX_CLOCK_PIN_LENGTH ? current : `${current}${digit}`,
                  );
                }}
                onBackspace={() => {
                  setError(null);
                  touch();
                  setPin((current) => current.slice(0, -1));
                }}
                onSubmit={() => void submitPin()}
              />
            </div>
          </div>
        )}
      </main>

      <footer className="text-center text-xs text-muted">
        {org?.name ?? "Workspace"} · signed in as device
      </footer>
    </div>
  );
}

function KioskProfile({
  session,
  timeZone,
  pending,
  error,
  onPunch,
  onDone,
}: {
  session: KioskUnlock;
  timeZone: string;
  pending: boolean;
  error: string | null;
  onPunch: (event: ClockEventType) => void;
  onDone: () => void;
}) {
  const actions = allowedEvents(session.state);
  return (
    <div className="rounded-3xl border border-line bg-white px-8 py-10 shadow-sm">
      <p className="text-center text-[11px] font-medium uppercase tracking-[0.2em] text-muted">
        Time clock
      </p>
      <div className="mt-6 flex flex-col items-center">
        <Avatar name={session.full_name} className="size-20 text-xl" />
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">{session.full_name}</h1>
        <p className="mt-1 text-muted">{session.position}</p>
        <Badge tone={stateTone(session.state)} dot className="mt-3">
          {stateLabel(session.state)}
        </Badge>
        {session.clocked_in_at ? (
          <p className="mt-3 text-sm text-muted">
            Clocked in {formatTimeInZone(session.clocked_in_at, timeZone)}
            {session.break_started_at
              ? ` · Break started ${formatTimeInZone(session.break_started_at, timeZone)}`
              : null}
          </p>
        ) : (
          <p className="mt-3 text-sm text-muted">Ready to clock in</p>
        )}
      </div>

      {error ? <p className="mt-4 text-center text-sm text-danger">{error}</p> : null}

      <div className="mt-8 grid grid-cols-2 gap-3">
        {CLOCK_EVENT_TYPES.map((event) => {
          const enabled = actions.includes(event) && !pending;
          const Icon = eventIcon(event);
          return (
            <Button
              key={event}
              className="h-16 text-base"
              variant={isPrimaryAction(event, session.state) ? "primary" : "ghost"}
              disabled={!enabled}
              onClick={() => onPunch(event)}
            >
              <Icon className="size-5" />
              {pending && actions.includes(event) ? "Saving…" : actionLabel(event)}
            </Button>
          );
        })}
      </div>

      <div className="mt-6 text-center">
        <button type="button" className="text-sm font-medium text-muted hover:text-ink" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
