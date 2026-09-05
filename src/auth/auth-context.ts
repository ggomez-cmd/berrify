import type { Session, User } from "@supabase/supabase-js";
import { createContext, useContext } from "react";
import type { MembershipRole, Organization } from "../lib/types";

export type AuthState = {
  session: Session | null;
  user: User | null;
  org: Organization | null;
  role: MembershipRole | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
