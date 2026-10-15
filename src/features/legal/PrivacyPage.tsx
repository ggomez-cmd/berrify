import { LegalDocument, LegalSection } from "./LegalDocument";

export function PrivacyPage() {
  return (
    <LegalDocument title="Privacy">
      <LegalSection title="About this notice">
        <p>
          This notice describes, at a high level, how the Berrify service may handle
          information. It is a public placeholder and does not name a legal entity or make
          privacy commitments beyond what a later reviewed policy will state.
        </p>
      </LegalSection>

      <LegalSection title="Accounts and data handling">
        <p>
          Berrify may store account identifiers, workspace membership, and operational
          records that users enter or upload, such as invoices, schedules, and inventory
          notes. Workspace owners decide who can see that information inside Berrify.
        </p>
      </LegalSection>

      <LegalSection title="Third-party services">
        <p>
          If a workspace connects a third-party service, including QuickBooks Online,
          Berrify may exchange the data needed for that connection (for example vendor or
          account lists and bill details the user chooses to send). Those providers process
          data under their own policies.
        </p>
      </LegalSection>

      <LegalSection title="License and acceptable use">
        <p>
          Use Berrify only with information you are allowed to process. Do not upload
          personal data that the workspace does not need for restaurant operations.
        </p>
      </LegalSection>

      <LegalSection title="Security">
        <p>
          Access is limited to signed-in workspace members. This placeholder does not
          describe subprocessors, retention periods, or a specific security certification.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          For privacy questions, contact the Berrify workspace owner who invited you. This
          placeholder does not list an email, mailing address, or legal entity.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
