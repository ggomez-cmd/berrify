import { LogOut } from "lucide-react";
import { useAuth } from "../../auth/auth-context";
import { Button } from "../ui/button";

export function Topbar({ title }: { title: string }) {
  const { org, user, signOut } = useAuth();

  return (
    <header className="flex items-center justify-between gap-3 border-b border-line bg-white px-6 py-4">
      <div>
        <h1 className="text-lg font-semibold text-navy">{title}</h1>
        <p className="text-xs text-muted">{org?.name ?? "Workspace"}</p>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden text-xs text-muted sm:inline">{user?.email}</span>
        <Button variant="ghost" onClick={() => void signOut()}>
          <LogOut className="size-4" />
          Sign out
        </Button>
      </div>
    </header>
  );
}
