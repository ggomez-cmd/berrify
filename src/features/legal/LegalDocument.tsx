import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BrandMark } from "../../components/ui/brand-mark";

export const LEGAL_EFFECTIVE_DATE = "2026-10-06";

export function LegalDocument({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-paper text-ink">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-5 py-10">
        <header className="mb-8">
          <BrandMark className="h-9 w-[8.4rem] text-wine" />
          <p className="mt-2 text-[11px] uppercase tracking-[0.2em] text-muted">Restaurant ERP</p>
          <nav className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Link className="font-medium text-wine hover:underline" to="/terms">
              Terms of Use
            </Link>
            <Link className="font-medium text-wine hover:underline" to="/privacy">
              Privacy
            </Link>
            <Link className="text-muted hover:underline" to="/login">
              Sign in
            </Link>
          </nav>
        </header>

        <article className="rounded-2xl border border-line bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm text-muted">Effective date: {LEGAL_EFFECTIVE_DATE}</p>
          <p className="mt-4 rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink">
            This is a placeholder for Intuit production app onboarding. The Berrify service
            owner or legal counsel should review and replace this text before production use.
          </p>
          <div className="mt-6 space-y-5 text-sm leading-6 text-ink">{children}</div>
        </article>
      </div>
    </div>
  );
}

export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <div className="mt-1 space-y-2 text-muted">{children}</div>
    </section>
  );
}
