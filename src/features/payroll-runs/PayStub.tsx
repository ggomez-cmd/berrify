import type { EarningsKind, PayrollCheck, TaxCode } from "../../lib/payroll-engine/types";
import { formatCents, formatHoursHundredths } from "./format";

const EARNING_LABELS: Record<EarningsKind, string> = {
  regular: "Regular",
  overtime: "Horas extra",
  salary: "Salario",
  tips: "Propinas",
  min_wage_makeup: "Ajuste a salario mínimo",
  adjustment: "Ajuste",
};

const TAX_LABELS: Partial<Record<TaxCode, string>> = {
  "FED-OASDI": "Seguro Social (6.2%)",
  "FED-MED": "Medicare (1.45%)",
  "FED-ADD-MED": "Medicare adicional (0.9%)",
  DIE: "SDI / SINOT (0.3%)",
  SWH: "Retención contributiva PR",
};

function usDate(ymd: string): string {
  const [year, month, day] = ymd.slice(0, 10).split("-");
  return `${month}/${day}/${year}`;
}

type StubEarning = { label: string; hoursHundredths: number; rateCents: number | null; amountCents: number };

// One row per kind and rate; adjustments stay separate so each reason shows.
function stubEarnings(check: PayrollCheck): StubEarning[] {
  const rows: StubEarning[] = [];
  const merged = new Map<string, StubEarning>();
  for (const line of check.earnings) {
    const label = line.kind === "adjustment" ? line.reason?.trim() || EARNING_LABELS.adjustment : EARNING_LABELS[line.kind];
    const key = line.kind === "adjustment" ? null : `${line.kind}\t${line.rateCents ?? ""}`;
    const existing = key === null ? undefined : merged.get(key);
    if (existing) {
      existing.hoursHundredths += line.hoursHundredths;
      existing.amountCents += line.amountCents;
      continue;
    }
    const row = { label, hoursHundredths: line.hoursHundredths, rateCents: line.rateCents, amountCents: line.amountCents };
    rows.push(row);
    if (key !== null) merged.set(key, row);
  }
  return rows;
}

function howCalculated(check: PayrollCheck): string {
  const amount = (code: TaxCode) => check.employeeWithholdings.find((line) => line.code === code)?.amountCents;
  const parts: string[] = [];
  const oasdi = check.employeeWithholdings.find((line) => line.code === "FED-OASDI");
  if (oasdi) {
    // Only wages under the annual Social Security limit are taxed, so use the taxable amount, not gross.
    const base = oasdi.taxableCents === check.grossCents ? "su gross" : "su salario sujeto a Seguro Social";
    parts.push(`Seguro Social: 6.2% de ${base} (${formatCents(oasdi.taxableCents)} × 6.2% = ${formatCents(oasdi.amountCents)}).`);
  }
  const medicare = amount("FED-MED");
  if (medicare !== undefined) parts.push(`Medicare: 1.45% (${formatCents(medicare)}).`);
  const addMedicare = amount("FED-ADD-MED");
  if (addMedicare !== undefined) parts.push(`Medicare adicional: 0.9% (${formatCents(addMedicare)}).`);
  const sdi = amount("DIE");
  if (sdi !== undefined) parts.push(`SDI (seguro por incapacidad): 0.3% (${formatCents(sdi)}).`);
  if (amount("SWH") !== undefined) {
    parts.push("Retención PR: es un adelanto de su contribución sobre ingresos del año; cuando radique la planilla se compara con lo que le toca.");
  }
  return parts.join(" ");
}

export function PayStub({
  check,
  employerName,
  employeeName,
  employeeNumber,
  paymentMethod,
  workplace,
  periodStart,
  periodEnd,
}: {
  check: PayrollCheck;
  employerName: string;
  employeeName: string;
  employeeNumber?: string;
  paymentMethod: string;
  workplace: string | null;
  periodStart: string;
  periodEnd: string;
}) {
  const earnings = stubEarnings(check);
  const ytdDeductionCents = check.employeeWithholdings.reduce(
    (sum, line) => sum + (check.closingYtd.withheldCents[line.code] ?? 0),
    0,
  );
  const explanation = howCalculated(check);
  const label = "text-[10px] font-medium uppercase tracking-wide text-muted";
  const money = "pl-3 text-right tabular-nums";

  return (
    <article className="pay-stub mb-6 break-inside-avoid rounded-2xl border border-line bg-white p-5 text-xs text-ink">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line pb-2">
        <div>
          <h2 className="text-base font-semibold uppercase tracking-tight">{employerName}</h2>
          {workplace ? <p className="text-muted">Lugar de trabajo: {workplace}</p> : null}
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Comprobante de pago / Pay stub</p>
      </header>

      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 print:grid-cols-4">
        <div>
          <dt className={label}>Empleado</dt>
          <dd className="font-semibold">
            {employeeName}
            {employeeNumber ? ` · #${employeeNumber}` : ""}
          </dd>
        </div>
        <div>
          <dt className={label}>Período de pago</dt>
          <dd>
            {usDate(periodStart)} - {usDate(periodEnd)}
          </dd>
        </div>
        <div>
          <dt className={label}>Fecha de pago</dt>
          <dd>{usDate(check.checkDate)}</dd>
        </div>
        <div>
          <dt className={label}>Forma de pago</dt>
          <dd>{paymentMethod}</dd>
        </div>
      </dl>

      <div className="mt-3 grid gap-4 md:grid-cols-2 print:grid-cols-2">
        <table className="w-full border-collapse">
          <thead>
            <tr className={label}>
              <th className="py-1 text-left font-medium">Ingresos</th>
              <th className="py-1 pl-3 text-right font-medium">Horas</th>
              <th className="py-1 pl-3 text-right font-medium">Tarifa</th>
              <th className="py-1 pl-3 text-right font-medium">Período</th>
            </tr>
          </thead>
          <tbody>
            {earnings.map((row, index) => (
              <tr key={`${row.label}-${index}`} className="border-t border-line">
                <td className="py-1 pr-2">{row.label}</td>
                <td className={`py-1 ${money}`}>{row.hoursHundredths ? formatHoursHundredths(row.hoursHundredths) : "—"}</td>
                <td className={`py-1 ${money}`}>{row.rateCents == null ? "—" : formatCents(row.rateCents)}</td>
                <td className={`py-1 ${money}`}>{formatCents(row.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="w-full border-collapse">
          <thead>
            <tr className={label}>
              <th className="py-1 text-left font-medium">Deducciones</th>
              <th className="py-1 pl-3 text-right font-medium">Período</th>
              <th className="py-1 pl-3 text-right font-medium">Acumulado</th>
            </tr>
          </thead>
          <tbody>
            {check.employeeWithholdings.map((line) => (
              <tr key={line.code} className="border-t border-line">
                <td className="py-1 pr-2">{TAX_LABELS[line.code] ?? line.code}</td>
                <td className={`py-1 ${money}`}>{formatCents(line.amountCents)}</td>
                <td className={`py-1 ${money}`}>{formatCents(check.closingYtd.withheldCents[line.code] ?? 0)}</td>
              </tr>
            ))}
            {check.employeeWithholdings.length === 0 ? (
              <tr className="border-t border-line">
                <td className="py-1 pr-2 text-muted" colSpan={3}>
                  {check.payType === "cash" ? "Sin deducciones (pago en efectivo)" : "Sin deducciones"}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="mt-3 grid gap-4 border-t border-line pt-2 font-semibold md:grid-cols-2 print:grid-cols-2">
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-4">
          <span>Total bruto (gross)</span>
          <span className={money}>{formatCents(check.grossCents)}</span>
          <span className={money}>{formatCents(check.closingYtd.grossCents)}</span>
        </div>
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-4">
          <span>Total deducciones</span>
          <span className={money}>{formatCents(check.employeeDeductionCents)}</span>
          <span className={money}>{formatCents(ytdDeductionCents)}</span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div className="text-[10px] text-muted">
          <p>Acumulado = pagos del año (incluye balances iniciales).</p>
          <p>Gross = ingresos del período. Neto = gross menos deducciones de ley.</p>
          <p>Conserve este comprobante para sus récords.</p>
        </div>
        <div className="rounded-xl border border-line bg-paper px-4 py-2 text-right">
          <p className={label}>Pago neto / Net pay</p>
          <p className="text-lg font-semibold tabular-nums">{formatCents(check.netCents)}</p>
          <p className="text-[10px] text-muted">
            Neto acumulado: {formatCents(check.closingYtd.grossCents - ytdDeductionCents)}
          </p>
        </div>
      </div>

      {explanation ? (
        <section className="mt-3 rounded-xl border border-line px-3 py-2">
          <h3 className={label}>Cómo se calculó su pago</h3>
          <p className="mt-1 text-[11px] leading-relaxed">{explanation}</p>
        </section>
      ) : null}
    </article>
  );
}
