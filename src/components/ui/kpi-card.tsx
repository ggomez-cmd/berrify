import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";
import { Card } from "./card";

type Tone = "wine" | "ok" | "warn" | "sky";

const tones: Record<Tone, string> = {
  wine: "bg-wine/10 text-wine",
  ok: "bg-ok/10 text-ok",
  warn: "bg-warn/10 text-warn",
  sky: "bg-sky/10 text-sky",
};

export function KpiCard({
  title,
  value,
  hint,
  icon: Icon,
  tone = "wine",
}: {
  title: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: Tone;
}) {
  return (
    <Card>
      <div className={cn("grid size-10 place-items-center rounded-full", tones[tone])}>
        <Icon className="size-5" />
      </div>
      <p className="mt-4 text-xs font-medium text-muted">{title}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-ink">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </Card>
  );
}
