import { env, isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getEvaluationSequence } from "@/lib/data/evaluation-sequence";
import { getReminderSettings } from "@/lib/data/reminder-settings";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { buildMessageSequence } from "@/lib/client-message-sequence";
import { SAMPLE_VARS } from "@/lib/evaluation-sequence";
import { DEFAULT_RULES } from "@/lib/client-reminders";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { MessagesJourney } from "@/components/messaging/messages-journey";

/**
 * Every automated email and text a client gets, in the order they get them,
 * each as it looks when it arrives: from the booking, through the visit, the
 * proposal and the job, to the invoice. The business's own wording and
 * switches, with a sample client. Nothing here sends.
 */
export const dynamic = "force-dynamic";

export default async function MessagesJourneyPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("reminders", "/my-day");

  const [organization, sequence, settings] = await Promise.all([
    getCurrentOrganization(),
    getEvaluationSequence().catch(() => null),
    getReminderSettings().catch(() => null),
  ]);
  const businessName = organization.name ?? "JS Landscaping MD";
  const baseUrl = (env.appUrl || "https://app.jslandscapingmd.com").replace(/\/$/, "");

  const messages = buildMessageSequence({
    businessName,
    steps: sequence?.steps ?? [],
    rules: settings?.rules ?? DEFAULT_RULES,
    remindersOn: settings?.enabled ?? false,
    approvalRequired: Boolean((organization as unknown as { require_email_approval?: boolean }).require_email_approval),
    vars: { ...SAMPLE_VARS, business: businessName },
    sample: { clientName: "Deanna Fields", address: SAMPLE_VARS.address, evaluator: SAMPLE_VARS.evaluator, manager: "Jace", baseUrl },
  });
  const fromEmail = (organization as unknown as { business_email?: string | null }).business_email ?? null;

  return <MessagesJourney messages={messages} businessName={businessName} fromEmail={fromEmail} />;
}
