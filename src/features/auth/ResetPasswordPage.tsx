import { Eye, EyeOff, Lock } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { BrandMark } from "../../components/ui/brand-mark";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { supabase } from "../../lib/supabase";

export function ResetPasswordPage() {
  const { session, loading, recovery, signOut } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && session && !recovery) {
    return <Navigate to="/" replace />;
  }

  const expired = !loading && (!session || !recovery);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      await signOut();
      navigate("/login", { replace: true, state: { passwordReset: true } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5">
        <div className="rounded-2xl border border-line bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-6 text-center">
            <BrandMark className="mx-auto h-10 w-[9.25rem] text-wine" />
            <p className="mt-2 text-[11px] uppercase tracking-[0.2em] text-muted">Restaurant ERP</p>
          </div>

          {loading ? (
            <p className="text-center text-sm text-muted">Loading…</p>
          ) : expired ? (
            <div className="text-center">
              <p className="text-sm text-ink">This link expired. Request a new one.</p>
              <Link
                to="/login?forgot=1"
                className="mt-4 inline-block font-medium text-wine hover:underline"
              >
                Request a new one
              </Link>
            </div>
          ) : (
            <form onSubmit={(e) => void onSubmit(e)}>
              <p className="mb-4 text-sm text-muted">Choose a new password for your account.</p>
              <div className="relative mb-3">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="New password"
                  className="px-9"
                  aria-label="New password"
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
              <div className="relative mb-4">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <Input
                  id="confirm"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  minLength={6}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Confirm password"
                  className="pl-9"
                  aria-label="Confirm password"
                />
              </div>
              {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Working…" : "Update password"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
