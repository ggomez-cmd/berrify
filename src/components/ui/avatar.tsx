import { cn } from "../../lib/cn";
import { initials } from "../../lib/format";

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-grid size-9 shrink-0 place-items-center rounded-full bg-wine/10 text-xs font-semibold text-wine",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
