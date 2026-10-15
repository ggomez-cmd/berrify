import { LegalDocument, LegalSection } from "./LegalDocument";

export function TermsPage() {
  return (
    <LegalDocument title="Terms of Use">
      <LegalSection title="About Berrify">
        <p>
          These terms describe use of Berrify, a restaurant operations service. They are a
          public placeholder and do not name a legal entity or create a binding commercial
          agreement.
        </p>
      </LegalSection>

      <LegalSection title="License and acceptable use">
        <p>
          Access to Berrify is limited to people invited by a workspace owner. You may use
          the service only for lawful restaurant operations such as scheduling, inventory,
          invoicing, and related bookkeeping workflows.
        </p>
        <p>
          Do not attempt to access another workspace, disrupt the service, scrape or
          reverse engineer the product beyond what is needed to use it, or use Berrify to
          submit false or unauthorized records.
        </p>
      </LegalSection>

      <LegalSection title="Accounts and data handling">
        <p>
          Workspace owners control who has an account. You are responsible for credentials
          issued to you and for information you enter. Berrify stores operational data that
          the workspace chooses to keep, including invoices and connection settings.
        </p>
      </LegalSection>

      <LegalSection title="Third-party services">
        <p>
          Berrify may connect to third-party services that a workspace enables, including
          QuickBooks Online. Those services have their own terms. Berrify does not become
          Intuit or any other third party by offering a connection.
        </p>
      </LegalSection>

      <LegalSection title="Security">
        <p>
          Use a unique password and keep access limited to people who need it. Report
          suspected misuse to the workspace owner. This page does not promise a specific
          security standard or uptime.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          For questions about these terms, contact the Berrify workspace owner who invited
          you. This placeholder does not list an email, mailing address, or legal entity.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
