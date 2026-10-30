export function assertInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer, got ${value}`);
  }
  return value;
}

export function roundHalfUpDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new Error("division by zero");
  }
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = n / d;
  const remainder = n % d;
  const rounded = remainder * 2n >= d ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

export function roundHalfUpRatio(numerator: number, denominator: number): number {
  return Number(roundHalfUpDiv(BigInt(assertInteger(numerator, "numerator")), BigInt(assertInteger(denominator, "denominator"))));
}

export function applyRateBp(amountCents: number, rateBp: number): number {
  return Number(
    roundHalfUpDiv(
      BigInt(assertInteger(amountCents, "amountCents")) * BigInt(assertInteger(rateBp, "rateBp")),
      10000n,
    ),
  );
}

export function amountFromHoursAndRate(hoursHundredths: number, rateCents: number): number {
  return Number(
    roundHalfUpDiv(
      BigInt(assertInteger(hoursHundredths, "hoursHundredths")) * BigInt(assertInteger(rateCents, "rateCents")),
      100n,
    ),
  );
}

export function applyMultiplierPpm(baseCents: number, multiplierPpm: number): number {
  return Number(
    roundHalfUpDiv(
      BigInt(assertInteger(baseCents, "baseCents")) * BigInt(assertInteger(multiplierPpm, "multiplierPpm")),
      1_000_000n,
    ),
  );
}

export function sumCents(values: readonly number[]): number {
  return values.reduce((total, value) => total + assertInteger(value, "cents"), 0);
}
