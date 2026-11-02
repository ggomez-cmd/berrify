import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

// `fluid` drops the minimum width so a narrow table fits its container instead of scrolling.
export function Table({ className, fluid = false, ...props }: HTMLAttributes<HTMLTableElement> & { fluid?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-white shadow-sm">
      <table className={cn("w-full border-collapse text-left text-sm", !fluid && "min-w-[720px]", className)} {...props} />
    </div>
  );
}

export function THead(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className="bg-[#f8f8fa] text-xs font-medium uppercase tracking-wide text-muted" {...props} />;
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("px-4 py-3 font-medium", className)} {...props} />;
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-t border-line px-4 py-3", className)} {...props} />;
}
