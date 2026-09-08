import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
      if (data.session?.user.id) {
        await loadWorkspace(data.session.user.id);
      }
      if (!cancelled) setLoading(false);
    };

    void boot();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (next?.user.id) {
        void loadWorkspace(next.user.id);
      } else {
        setOrg(null);
        setRole(null);
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [loadWorkspace]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
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
      signOut,
    }),
    [session, org, role, loading, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
