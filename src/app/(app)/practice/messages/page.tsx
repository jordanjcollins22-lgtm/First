import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getClientMessageSequence } from "@/lib/data/client-message-sequence";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { MessagesJourney } from "@/components/messaging/messages-journey";

/**
 * Every automated email and text a client gets, in the order they get them,
 * each as it looks when it arrives, numbered by the step on The system it
 * belongs to. The business's own wording and switches, with a sample
 * client. Nothing here sends.
 */
export const dynamic = "force-dynamic";

export default async function MessagesJourneyPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("reminders", "/my-day");
  const { messages, businessName, fromEmail } = await getClientMessageSequence();
  return <MessagesJourney messages={messages} businessName={businessName} fromEmail={fromEmail} />;
}
