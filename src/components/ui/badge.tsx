import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type Tone = "ok" | "warn" | "danger" | "neutral" | "info";

const tones: Record<Tone, string> = {
  ok: "bg-ok/10 text-ok border-ok/20",
  warn: "bg-warn/10 text-warn border-warn/25",
  danger: "bg-danger/10 text-danger border-danger/20",
  neutral: "bg-slate-100 text-slate-600 border-slate-200",
  info: "bg-sky/10 text-sky border-sky/20",
};

const dots: Record<Tone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  neutral: "bg-slate-400",
  info: "bg-sky",
};

export function Badge({
  tone = "neutral",
  dot = false,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone; dot?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
      {...props}
    >
      {dot ? <span className={cn("size-1.5 rounded-full", dots[tone])} /> : null}
      {children}
    </span>
  );
}
