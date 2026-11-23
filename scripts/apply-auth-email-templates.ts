import dotenv from "dotenv";
import {
  INVITE_LINK,
  INVITE_SUBJECT,
  projectRefFromSupabaseUrl,
  readInviteTemplate,
  readRecoveryTemplate,
  RECOVERY_SUBJECT,
  RECOVERY_TEMPLATE_MAX_CHARS,
} from "./auth-email-templates.ts";

dotenv.config();

const template = readRecoveryTemplate();
if (template.length > RECOVERY_TEMPLATE_MAX_CHARS) {
  throw new Error(
    `Recovery template is ${template.length} characters; keep it at or under ${RECOVERY_TEMPLATE_MAX_CHARS}.`,
  );
}
if (!template.includes("{{ .ConfirmationURL }}")) {
  throw new Error("Recovery template must include {{ .ConfirmationURL }}.");
}

const invite = readInviteTemplate();
if (invite.length > RECOVERY_TEMPLATE_MAX_CHARS) {
  throw new Error(
    `Invite template is ${invite.length} characters; keep it at or under ${RECOVERY_TEMPLATE_MAX_CHARS}.`,
  );
}
if (!invite.includes(INVITE_LINK)) {
  throw new Error("Invite template must link to the accept-invite token URL.");
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!supabaseUrl) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL is required.");
}
if (!token) {
  throw new Error(
    "SUPABASE_ACCESS_TOKEN is required. Create one at https://supabase.com/dashboard/account/tokens, then either run this script or paste supabase/templates/recovery.html and invite.html into Authentication → Email Templates (Reset password, Invite user).",
  );
}

const projectRef = projectRefFromSupabaseUrl(supabaseUrl);
const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/config/auth`, {
  method: "PATCH",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    mailer_subjects_recovery: RECOVERY_SUBJECT,
    mailer_templates_recovery_content: template,
    mailer_subjects_invite: INVITE_SUBJECT,
    mailer_templates_invite_content: invite,
  }),
});

if (!response.ok) {
  const detail = await response.text();
  throw new Error(`Failed to update auth email templates (${response.status}): ${detail}`);
}

console.log(`Updated Reset password and Invite user emails for project ${projectRef}.`);
console.log(`Subjects: ${RECOVERY_SUBJECT} / ${INVITE_SUBJECT}`);
