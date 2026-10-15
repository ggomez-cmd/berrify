import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { LEGAL_EFFECTIVE_DATE } from "./LegalDocument";
import { PrivacyPage } from "./PrivacyPage";
import { TermsPage } from "./TermsPage";

function renderLegal(path: "/terms" | "/privacy") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("public legal pages", () => {
  it("renders terms for Berrify without requiring auth", () => {
    renderLegal("/terms");

    expect(screen.getByRole("heading", { name: "Terms of Use" })).toBeInTheDocument();
    expect(screen.getByText(`Effective date: ${LEGAL_EFFECTIVE_DATE}`)).toBeInTheDocument();
    expect(screen.getByText(/placeholder for Intuit production app onboarding/i)).toBeInTheDocument();
    expect(screen.getByText(/legal counsel should review/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "License and acceptable use" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Accounts and data handling" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Third-party services" })).toBeInTheDocument();
    expect(screen.getByText(/QuickBooks Online/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Security" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Contact" })).toBeInTheDocument();
    expect(screen.getByText(/does not list an email, mailing address, or legal entity/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
  });

  it("renders privacy for Berrify without requiring auth", () => {
    renderLegal("/privacy");

    expect(screen.getByRole("heading", { name: "Privacy" })).toBeInTheDocument();
    expect(screen.getByText(`Effective date: ${LEGAL_EFFECTIVE_DATE}`)).toBeInTheDocument();
    expect(screen.getByText(/placeholder for Intuit production app onboarding/i)).toBeInTheDocument();
    expect(screen.getByText(/legal counsel should review/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Accounts and data handling" })).toBeInTheDocument();
    expect(screen.getByText(/QuickBooks Online/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Security" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Terms of Use" })).toHaveAttribute("href", "/terms");
  });
});
