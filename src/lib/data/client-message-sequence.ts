import { env } from "@/lib/env";
import { getEvaluationSequence } from "@/lib/data/evaluation-sequence";
import { getReminderSettings } from "@/lib/data/reminder-settings";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { buildMessageSequence, type SequenceMessage } from "@/lib/client-message-sequence";
import { SAMPLE_VARS } from "@/lib/evaluation-sequence";
import { DEFAULT_RULES } from "@/lib/client-reminders";

/** Every automated message to a client, in order, as this business has them. */
export async function getClientMessageSequence(): Promise<{ messages: SequenceMessage[]; businessName: string; fromEmail: string | null }> {
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
  return { messages, businessName, fromEmail: (organization as unknown as { business_email?: string | null }).business_email ?? null };
}
