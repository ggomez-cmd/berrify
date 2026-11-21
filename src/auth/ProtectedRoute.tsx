import { Navigate, Outlet, useLocation } from "react-router-dom";
import { kioskLockRedirect } from "../lib/kiosk";
import { useAuth } from "./auth-context";

export function ProtectedRoute() {
  const { session, loading, recovery, role } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center text-muted">
        Loading workspace…
      </div>
    );
  }

  if (recovery) {
    return <Navigate to="/reset-password" replace />;
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  const kioskLock = kioskLockRedirect(role, location.pathname);
  if (kioskLock) {
    return <Navigate to={kioskLock} replace />;
  }

  return <Outlet />;
}
