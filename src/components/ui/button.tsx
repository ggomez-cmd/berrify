import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type Variant = "primary" | "ghost" | "danger" | "subtle";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
};

const variants: Record<Variant, string> = {
  primary:
    "bg-linear-to-r from-berry to-plum text-white shadow-[0_10px_30px_rgba(124,58,237,0.35)] hover:brightness-110",
  ghost: "bg-white/6 border border-white/12 text-fog hover:bg-white/10",
  danger: "bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25",
  subtle: "bg-transparent text-mist hover:text-fog hover:bg-white/6",
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
