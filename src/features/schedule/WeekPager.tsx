import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../../components/ui/button";
import { addDays, formatWeekLabel, weekStart } from "../../lib/schedule";

export function WeekPager({
  cursor,
  setCursor,
}: {
  cursor: Date;
  setCursor: (d: Date) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button variant="ghost" className="px-2" onClick={() => setCursor(addDays(cursor, -7))} aria-label="Previous week">
        <ChevronLeft className="size-4" />
      </Button>
      <Button variant="ghost" className="min-w-0 sm:min-w-48">
        <CalendarDays className="size-4" />
        {formatWeekLabel(cursor)}
      </Button>
      <Button variant="ghost" className="px-2" onClick={() => setCursor(addDays(cursor, 7))} aria-label="Next week">
        <ChevronRight className="size-4" />
      </Button>
      <Button variant="subtle" onClick={() => setCursor(weekStart(new Date()))}>
        This week
      </Button>
    </div>
  );
}
