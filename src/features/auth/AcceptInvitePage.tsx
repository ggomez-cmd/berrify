import { Eye, EyeOff, KeyRound, Lock } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BrandMark } from "../../components/ui/brand-mark";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { isValidClockPin, normalizeClockPin } from "../../lib/pin";
import { supabase } from "../../lib/supabase";

// Employees get this page from the invite email, so it is in Spanish.
type Phase = "verifying" | "ready" | "invalid" | "error";

export function AcceptInvitePage() {
  const navigate = useNavigate();
  const started = useRef(false);
  const [phase, setPhase] = useState<Phase>("verifying");
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [needsPin, setNeedsPin] = useState(false);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Without a token (a refresh after verifying), the invited user is still
    // signed in and can finish. A token that fails never falls back to another
    // signed-in account.
    const showForSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setPhase("invalid");
        return;
      }
      setAccountEmail(data.session.user.email ?? null);
      const { data: status, error: statusError } = await supabase.rpc("my_clock_pin_status");
      if (statusError) {
        setPhase("error");
        return;
      }
      const row = (status as Array<{ has_pin: boolean }> | null)?.[0];
      setNeedsPin(row ? !row.has_pin : false);
      setPhase("ready");
    };
    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get("token_hash");
    if (!tokenHash || params.get("type") !== "invite") {
      void showForSession();
      return;
    }
    void supabase.auth.verifyOtp({ token_hash: tokenHash, type: "invite" }).then(({ error: verifyError }) => {
      window.history.replaceState(null, "", window.location.pathname);
      if (verifyError) {
        setPhase("invalid");
        return;
      }
      return showForSession();
    });
  }, []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    if (needsPin) {
      if (!isValidClockPin(pin)) {
        setError("El PIN debe tener de 4 a 8 dígitos.");
        return;
      }
      if (pin !== confirmPin) {
        setError("Los PIN no coinciden.");
        return;
      }
    }
    setBusy(true);
    try {
      if (needsPin) {
        const { data: result, error: pinErr } = await supabase.rpc("set_my_clock_pin", { pin });
        if (pinErr) throw pinErr;
        if (result === "taken") {
          setPin("");
          setConfirmPin("");
          setError("Ese PIN no está disponible. Escoge otro.");
          return;
        }
        setNeedsPin(false);
        if (result === "locked") {
          setNotice(
            "Demasiados intentos con PIN no disponibles. Tu gerente asignará tu PIN. Presiona Crear cuenta para terminar.",
          );
          return;
        }
      }
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      navigate("/", { replace: true });
    } catch {
      setError("No se pudo completar. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-paper" lang="es">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5">
        <div className="rounded-2xl border border-line bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-6 text-center">
            <BrandMark className="mx-auto h-10 w-[9.25rem] text-wine" />
            <p className="mt-2 text-[11px] uppercase tracking-[0.2em] text-muted">Restaurant ERP</p>
          </div>

          {phase === "verifying" ? (
            <p className="text-center text-sm text-muted">Verificando tu invitación…</p>
          ) : phase === "error" ? (
            <p className="text-center text-sm text-ink">
              No pudimos cargar tu cuenta. Recarga la página para intentarlo de nuevo.
            </p>
          ) : phase === "invalid" ? (
            <div className="text-center">
              <p className="text-sm text-ink">
                Este enlace expiró o ya se usó. Si ya creaste tu cuenta, usa ¿Olvidaste tu contraseña?
                Si no, pídele a tu gerente que te envíe la invitación otra vez.
              </p>
              <div className="mt-4 flex justify-center gap-4">
                <Link to="/login?forgot=1" className="font-medium text-wine hover:underline">
                  ¿Olvidaste tu contraseña?
                </Link>
                <Link to="/login" className="font-medium text-wine hover:underline">
                  Iniciar sesión
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={(e) => void onSubmit(e)}>
              <p className="mb-4 text-sm text-muted">
                Bienvenido a Berrify. Crea una contraseña para {accountEmail ?? "tu cuenta"}
                {needsPin ? " y un PIN para marcar entrada y salida en el kiosco" : ""}.
              </p>
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
                  placeholder="Contraseña"
                  className="px-9"
                  aria-label="Contraseña"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
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
                  placeholder="Confirmar contraseña"
                  className="pl-9"
                  aria-label="Confirmar contraseña"
                />
              </div>
              {needsPin ? (
                <>
                  <div className="relative mb-3">
                    <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                    <Input
                      id="pin"
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      required
                      value={pin}
                      onChange={(e) => setPin(normalizeClockPin(e.target.value))}
                      placeholder="PIN del kiosco (4 a 8 dígitos)"
                      className="pl-9"
                      aria-label="PIN del kiosco"
                    />
                  </div>
                  <div className="relative mb-4">
                    <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                    <Input
                      id="confirm-pin"
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      required
                      value={confirmPin}
                      onChange={(e) => setConfirmPin(normalizeClockPin(e.target.value))}
                      placeholder="Confirmar PIN"
                      className="pl-9"
                      aria-label="Confirmar PIN"
                    />
                  </div>
                </>
              ) : null}
              {notice ? <p className="mb-3 text-sm text-muted">{notice}</p> : null}
              {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Guardando…" : "Crear cuenta"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
