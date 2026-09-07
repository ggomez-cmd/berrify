import { Search } from "lucide-react";
import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn";
import { Input } from "./input";

export function SearchInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cn("relative w-72 max-w-full", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
      <Input className="pl-9" {...props} />
    </div>
  );
}
