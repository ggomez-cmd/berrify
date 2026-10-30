import { PR_2026, type PrTaxSchedule } from "./pr-2026";

const SCHEDULES: readonly PrTaxSchedule[] = [PR_2026];

export function selectTaxSchedule(checkDate: string): PrTaxSchedule {
  const applicable = SCHEDULES.filter((schedule) => schedule.effectiveFrom <= checkDate).sort((a, b) =>
    b.effectiveFrom.localeCompare(a.effectiveFrom),
  );
  const selected = applicable[0];
  if (!selected) {
    throw new Error(`No Puerto Rico tax schedule is effective on ${checkDate}`);
  }
  return selected;
}

export { PR_2026 };
export type { PrTaxSchedule };
