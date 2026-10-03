import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getClientMessageSequence } from "@/lib/data/client-message-sequence";
import { systemStepNumbers } from "@/lib/client-message-sequence";
import { SYSTEM_FLOW } from "@/lib/system-flow";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { MessagesJourney } from "@/components/messaging/messages-journey";

/**
 * Every automated email and text a client gets, in the order they get them,
 * each as it looks when it arrives, numbered by the step on The system it
 * belongs to. The business's own wording and switches, with a sample
 * client. Nothing here sends.
 */
export const dynamic = "force-dynamic";

export default async function MessagesJourneyPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("reminders", "/my-day");
  const { step: stepKey } = await searchParams;
  const { messages, businessName, fromEmail } = await getClientMessageSequence();

  // Opened from a step on The system: only that step's automations.
  const square = stepKey ? SYSTEM_FLOW.flatMap((stage) => stage.squares).find((sq) => sq.key === stepKey) : null;
  const step = square && messages.some((m) => m.square === square.key) ? { key: square.key, number: systemStepNumbers().get(square.key) ?? null, title: square.title } : null;

  return <MessagesJourney messages={messages} businessName={businessName} fromEmail={fromEmail} step={step} />;
}
