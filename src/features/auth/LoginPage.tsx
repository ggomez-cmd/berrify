import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Field } from "../../components/ui/label";
import { DEMO_EMAIL, DEMO_PASSWORD } from "../../lib/constants";
import { supabase } from "../../lib/supabase";

type Mode = "signin" | "signup";

export function LoginPage() {
  const { session, loading } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
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
    <div className="relative min-h-screen overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-1/4 h-[70vh] bg-[radial-gradient(40%_55%_at_20%_30%,rgba(244,114,182,0.35),transparent_70%),radial-gradient(45%_50%_at_80%_20%,rgba(124,58,237,0.4),transparent_70%)] blur-xl"
      />
      <div className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center px-5">
        <div className="mb-8 flex items-center gap-3">
          <img src="/berry.svg" alt="" className="size-9" />
          <div>
            <p className="text-lg font-bold tracking-tight">Berrify</p>
            <p className="text-xs uppercase tracking-[0.18em] text-mist">Restaurant ERP</p>
          </div>
        </div>

        <form
          onSubmit={(e) => void onSubmit(e)}
          className="rounded-2xl border border-white/10 bg-white/4 p-6 backdrop-blur"
        >
          <h1 className="mb-1 text-xl font-semibold">
            {mode === "signin" ? "Sign in" : "Create your workspace"}
          </h1>
          <p className="mb-5 text-sm text-mist">
            Inventory, suppliers, and stock movements for one restaurant.
          </p>

          {mode === "signup" ? (
            <div className="mb-3">
              <Field label="Restaurant name" htmlFor="org">
                <Input
                  id="org"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="Pacifico Kitchen"
                />
              </Field>
            </div>
          ) : null}

          <div className="mb-3">
            <Field label="Email" htmlFor="email">
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
          </div>
          <div className="mb-4">
            <Field label="Password" htmlFor="password">
              <Input
                id="password"
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          </div>

          {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}
          {info ? <p className="mb-3 text-sm text-ok">{info}</p> : null}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
          </Button>

          <button
            type="button"
            className="mt-3 w-full text-center text-sm text-mist hover:text-fog"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
              setInfo(null);
            }}
          >
            {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
          </button>

          <Button
            type="button"
            variant="ghost"
            className="mt-4 w-full"
            onClick={() => {
              setMode("signin");
              setEmail(demoEmail);
              setPassword(demoPassword);
            }}
          >
            Fill demo credentials
          </Button>
        </form>
      </div>
    </div>
  );
}
