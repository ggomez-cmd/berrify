import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  setPasswordRecoveryFlag,
  shouldTreatSessionAsRecovery,
} from "../lib/password-recovery";
import { supabase } from "../lib/supabase";
import type { MembershipRole, Organization } from "../lib/types";
import { AuthContext, type AuthState } from "./auth-context";

type MembershipRow = {
  role: MembershipRole;
  organizations: Organization | Organization[] | null;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [org, setOrg] = useState<Organization | null>(null);
  const [role, setRole] = useState<MembershipRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(() =>
    typeof window === "undefined" ? false : shouldTreatSessionAsRecovery(window.location),
  );

  const loadWorkspace = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from("memberships")
      .select("role, organizations(*)")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error(error);
      setOrg(null);
      setRole(null);
      return;
    }

    const row = data as MembershipRow | null;
    const organization = Array.isArray(row?.organizations)
      ? row.organizations[0] ?? null
      : row?.organizations ?? null;
    setOrg(organization);
    setRole(row?.role ?? null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setSession(data.session);
      const recovering = shouldTreatSessionAsRecovery(window.location);
      if (recovering) {
        setPasswordRecoveryFlag(true);
        setRecovery(true);
        if (!cancelled) setLoading(false);
        return;
      }
      if (data.session?.user.id) {
        await loadWorkspace(data.session.user.id);
      }
      if (!cancelled) setLoading(false);
    };

    void boot();

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === "INITIAL_SESSION") return;
      setSession(next);
      if (event === "PASSWORD_RECOVERY") {
        setPasswordRecoveryFlag(true);
        setRecovery(true);
        setOrg(null);
        setRole(null);
        setLoading(false);
        return;
      }
      if (event === "SIGNED_OUT" || !next?.user.id) {
        setPasswordRecoveryFlag(false);
        setRecovery(false);
        setOrg(null);
        setRole(null);
        setLoading(false);
        return;
      }
      if (event === "SIGNED_IN") {
        const onResetPath = /\/reset-password\/?$/.test(window.location.pathname);
        if (shouldTreatSessionAsRecovery(window.location) || onResetPath) {
          setPasswordRecoveryFlag(true);
          setRecovery(true);
          setOrg(null);
          setRole(null);
          setLoading(false);
          return;
        }
        setLoading(true);
        void loadWorkspace(next.user.id).finally(() => {
          if (!cancelled) setLoading(false);
        });
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [loadWorkspace]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setPasswordRecoveryFlag(false);
    setRecovery(false);
    setOrg(null);
    setRole(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      org,
      role,
      loading,
      recovery,
      signOut,
    }),
    [session, org, role, loading, recovery, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
