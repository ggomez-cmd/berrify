import { LogOut } from "lucide-react";
import { useAuth } from "../../auth/auth-context";
import { cn } from "../../lib/cn";

export function SignOutButton({
  className,
  onSignedOut,
}: {
  className?: string;
  onSignedOut?: () => void;
}) {
  const { signOut } = useAuth();

  return (
    <button
      type="button"
      onClick={() => {
        onSignedOut?.();
        void signOut();
      }}
      className={cn(
        "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-muted hover:bg-paper hover:text-ink",
        className,
      )}
    >
      <LogOut className="size-4" />
      Sign out
    </button>
  );
}
