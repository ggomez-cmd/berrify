import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type Variant = "primary" | "ghost" | "danger" | "subtle";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
};

const variants: Record<Variant, string> = {
  primary: "bg-wine text-white shadow-sm hover:bg-wine-deep",
  ghost: "bg-white border border-line text-ink hover:bg-paper",
  danger: "bg-danger/10 text-danger border border-danger/25 hover:bg-danger/15",
  subtle: "bg-transparent text-muted hover:text-ink hover:bg-paper",
};

export function Button({ variant = "primary", className, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
