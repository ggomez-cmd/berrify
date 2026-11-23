import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  INVITE_LINK,
  INVITE_SUBJECT,
  projectRefFromSupabaseUrl,
  RECOVERY_SUBJECT,
  RECOVERY_TEMPLATE_MAX_CHARS,
} from "./auth-email-templates.ts";

const recoveryHtml = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../supabase/templates/recovery.html"),
  "utf8",
);

const inviteHtml = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../supabase/templates/invite.html"),
  "utf8",
);

describe("invite email template", () => {
  it("links to the accept-invite page with a token hash", () => {
    expect(inviteHtml.length).toBeLessThanOrEqual(RECOVERY_TEMPLATE_MAX_CHARS);
    expect(inviteHtml).toContain(`href="${INVITE_LINK}"`);
    expect(inviteHtml).not.toContain("{{ .ConfirmationURL }}");
    expect(INVITE_SUBJECT).toBe("Te invitaron a Berrify");
  });
});

describe("recovery email template", () => {
  it("stays under the dashboard character limit and includes the reset link", () => {
    expect(recoveryHtml.length).toBeLessThanOrEqual(RECOVERY_TEMPLATE_MAX_CHARS);
    expect(recoveryHtml).toContain("{{ .ConfirmationURL }}");
    expect(recoveryHtml).toContain("https://berrify.app/email/berrify-wordmark.png");
    expect(recoveryHtml).toContain("#7B1924");
    expect(RECOVERY_SUBJECT).toBe("Reset your Berrify password");
  });

  it("reads the project ref from the hosted URL", () => {
    expect(projectRefFromSupabaseUrl("https://abcdxyz.supabase.co")).toBe("abcdxyz");
  });
});
