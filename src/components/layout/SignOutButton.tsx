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
        "inline-flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium text-muted hover:bg-paper hover:text-ink",
        className,
      )}
      aria-label="Sign out"
    >
      <LogOut className="size-4 shrink-0" />
      Sign out
    </button>
  );
}
