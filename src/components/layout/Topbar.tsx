import { useAuth } from "../../auth/auth-context";

export function Topbar({ title }: { title: string }) {
  const { org, user } = useAuth();

  return (
    <header className="flex items-center justify-between gap-3 border-b border-line bg-white px-6 py-4">
      <div>
        <h1 className="text-lg font-semibold text-navy">{title}</h1>
        <p className="text-xs text-muted">{org?.name ?? "Workspace"}</p>
      </div>
      <span className="hidden text-xs text-muted sm:inline">{user?.email}</span>
    </header>
  );
}
