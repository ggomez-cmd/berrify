import { PR_2026, type PrTaxSchedule } from "./pr-2026";

const SCHEDULES: readonly PrTaxSchedule[] = [PR_2026];

export function assertCheckDate(checkDate: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(checkDate);
  const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
  if (!date || date.toISOString().slice(0, 10) !== checkDate) {
    throw new Error(`Check date must be a real YYYY-MM-DD date, got ${checkDate}`);
  }
}

export function selectTaxSchedule(checkDate: string): PrTaxSchedule {
  assertCheckDate(checkDate);
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
