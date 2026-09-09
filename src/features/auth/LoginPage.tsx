import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { BrandMark } from "../../components/ui/brand-mark";
import {
  clearLoginFailures,
  isHoneypotFilled,
  loginLockRemainingMs,
  recordLoginFailure,
} from "../../lib/login-guard";
import { supabase } from "../../lib/supabase";

type Mode = "signin" | "forgot";

type LoginLocationState = {
  passwordReset?: boolean;
};

const RESET_SENT_MESSAGE =
  "If an account exists for that email, we sent a reset link.";

function submitLabel(mode: Mode, busy: boolean): string {
  if (busy) return "Working…";
  switch (mode) {
    case "signin":
      return "Sign in";
    case "forgot":
      return "Send reset link";
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

function initialMode(search: string): Mode {
  return new URLSearchParams(search).get("forgot") === "1" ? "forgot" : "signin";
}

export function LoginPage() {
  const { session, loading, recovery } = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState<Mode>(() => initialMode(location.search));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [website, setWebsite] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(() => {
    const state = location.state as LoginLocationState | null;
    return state?.passwordReset ? "Password updated. Sign in with your new password." : null;
  });
  const [busy, setBusy] = useState(false);

  if (!loading && recovery) {
    return <Navigate to="/reset-password" replace />;
  }

  if (!loading && session) {
    return <Navigate to="/" replace />;
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setInfo(null);
    const lockMs = loginLockRemainingMs();
    if (lockMs > 0) {
      setError(`Too many attempts. Try again in ${Math.ceil(lockMs / 1000)} seconds.`);
      return;
    }
    if (isHoneypotFilled(website)) {
      if (mode === "forgot") {
        setInfo(RESET_SENT_MESSAGE);
      } else {
        setError("Invalid email or password");
      }
      return;
    }
    setBusy(true);
    try {
      switch (mode) {
        case "signin": {
          const { error: signError } = await supabase.auth.signInWithPassword({ email, password });
          if (signError) {
            const remaining = recordLoginFailure();
            if (remaining > 0) {
              throw new Error(`Too many attempts. Try again in ${Math.ceil(remaining / 1000)} seconds.`);
            }
            throw signError;
          }
          clearLoginFailures();
          break;
        }
        case "forgot": {
          const redirectTo = `${window.location.origin}/reset-password`;
          await supabase.auth.resetPasswordForEmail(email, { redirectTo });
          setInfo(RESET_SENT_MESSAGE);
          break;
        }
        default: {
          const _exhaustive: never = mode;
          return _exhaustive;
        }
      }
    } catch (err) {
      if (mode === "forgot") {
        setInfo(RESET_SENT_MESSAGE);
      } else {
        setError(err instanceof Error ? err.message : "Authentication failed");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5">
        <form
          onSubmit={(e) => void onSubmit(e)}
          className="rounded-2xl border border-line bg-white p-6 shadow-sm sm:p-8"
        >
          <div className="mb-6 text-center">
            <BrandMark className="mx-auto h-10 w-[9.25rem] text-wine" />
            <p className="mt-2 text-[11px] uppercase tracking-[0.2em] text-muted">Restaurant ERP</p>
          </div>

          <div className="relative mb-3" aria-hidden="true">
            <label className="sr-only" htmlFor="website">
              Website
            </label>
            <input
              id="website"
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              className="absolute -left-[9999px] h-0 w-0 opacity-0"
            />
          </div>

          <div className="relative mb-3">
            <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="pl-9"
              aria-label="Email"
            />
          </div>

          {mode === "signin" ? (
            <div className="relative mb-4">
              <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="px-9"
                aria-label="Password"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          ) : (
            <p className="mb-4 text-sm text-muted">
              Enter your email and we will send a link to set a new password.
            </p>
          )}

          {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}
          {info ? <p className="mb-3 text-sm text-ok">{info}</p> : null}

          <Button type="submit" className="w-full" disabled={busy}>
            {submitLabel(mode, busy)}
          </Button>

          <div className="mt-5 border-t border-line pt-4 text-center text-sm">
            {mode === "signin" ? (
              <button
                type="button"
                className="font-medium text-wine hover:underline"
                onClick={() => {
                  setMode("forgot");
                  setError(null);
                  setInfo(null);
                }}
              >
                Forgot password?
              </button>
            ) : (
              <button
                type="button"
                className="font-medium text-wine hover:underline"
                onClick={() => {
                  setMode("signin");
                  setError(null);
                  setInfo(null);
                }}
              >
                Back to sign in
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
