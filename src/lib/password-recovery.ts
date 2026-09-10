const RECOVERY_KEY = "berrify.password-recovery";

export function readPasswordRecoveryFlag(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  return sessionStorage.getItem(RECOVERY_KEY) === "1";
}

export function setPasswordRecoveryFlag(active: boolean): void {
  if (typeof sessionStorage === "undefined") return;
  if (active) {
    sessionStorage.setItem(RECOVERY_KEY, "1");
    return;
  }
  sessionStorage.removeItem(RECOVERY_KEY);
}

export function urlIndicatesPasswordRecovery(
  location: Pick<Location, "hash" | "search" | "pathname">,
): boolean {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const search = new URLSearchParams(location.search);
  if (hash.get("type") === "recovery" || search.get("type") === "recovery") {
    return true;
  }
  const onResetPath = /\/reset-password\/?$/.test(location.pathname);
  return onResetPath && (search.has("code") || hash.has("access_token"));
}

export function shouldTreatSessionAsRecovery(
  location: Pick<Location, "hash" | "search" | "pathname">,
): boolean {
  return readPasswordRecoveryFlag() || urlIndicatesPasswordRecovery(location);
}
