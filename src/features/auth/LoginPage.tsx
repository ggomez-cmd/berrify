import { Eye, EyeOff, Lock, Mail, User, Users } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { BrandMark } from "../../components/ui/brand-mark";
import { DEMO_EMAIL, DEMO_PASSWORD, DEMO_STAFF_EMAIL } from "../../lib/constants";
import { supabase } from "../../lib/supabase";

type Mode = "signin" | "signup";

export function LoginPage() {
  const { session, loading } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && session) {
    return <Navigate to="/" replace />;
  }

  const demoEmail = import.meta.env.NEXT_PUBLIC_DEMO_EMAIL ?? DEMO_EMAIL;
  const demoPassword = import.meta.env.NEXT_PUBLIC_DEMO_PASSWORD ?? DEMO_PASSWORD;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error: signError } = await supabase.auth.signInWithPassword({ email, password });
        if (signError) throw signError;
      } else {
        const { data, error: signError } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { org_name: orgName || undefined } },
        });
        if (signError) throw signError;
        if (!data.session) {
          setInfo("Check your email to confirm the account, then sign in.");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5">
        <form
          onSubmit={(e) => void onSubmit(e)}
          className="rounded-2xl border border-line bg-white p-8 shadow-sm"
        >
          <div className="mb-6 text-center">
            <BrandMark className="mx-auto h-10 w-[9.25rem] text-wine" />
            <p className="mt-2 text-[11px] uppercase tracking-[0.2em] text-muted">Restaurant ERP</p>
          </div>

          {mode === "signup" ? (
            <div className="mb-3">
              <Input
                id="org"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Restaurant name"
                aria-label="Restaurant name"
              />
            </div>
          ) : null}

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
          <div className="relative mb-4">
            <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
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

          {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}
          {info ? <p className="mb-3 text-sm text-ok">{info}</p> : null}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
          </Button>

          {mode === "signin" ? (
            <div className="mt-3 grid gap-2">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setEmail(demoEmail);
                  setPassword(demoPassword);
                }}
              >
                <User className="size-4" />
                Fill manager demo
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setEmail(import.meta.env.NEXT_PUBLIC_DEMO_STAFF_EMAIL ?? DEMO_STAFF_EMAIL);
                  setPassword(demoPassword);
                }}
              >
                <Users className="size-4" />
                Fill staff demo
              </Button>
            </div>
          ) : null}

          <div className="mt-5 border-t border-line pt-4 text-center text-sm">
            {mode === "signin" ? (
              <>
                <span className="text-muted">Need an account? </span>
                <button
                  type="button"
                  className="font-medium text-wine hover:underline"
                  onClick={() => {
                    setMode("signup");
                    setError(null);
                    setInfo(null);
                  }}
                >
                  Sign up
                </button>
              </>
            ) : (
              <>
                <span className="text-muted">Already have an account? </span>
                <button
                  type="button"
                  className="font-medium text-wine hover:underline"
                  onClick={() => {
                    setMode("signin");
                    setError(null);
                    setInfo(null);
                  }}
                >
                  Sign in
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
