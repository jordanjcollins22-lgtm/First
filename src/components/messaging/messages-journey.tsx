import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import type { SequenceMessage } from "@/lib/client-message-sequence";
import { JourneyPages, type JourneyStep } from "@/components/practice/journey-pages";
import { EmailPreview, TextPreview } from "@/components/messaging/message-preview";

/**
 * The client's emails and texts in order, each as it arrives, laid out
 * like the other pages of The system: emails or texts at the top, and the
 * emails that are switched off behind a chip.
 */
function status(m: SequenceMessage): string {
  if (m.note) return m.note;
  if (!m.on) return m.channel === "sms" ? "Switched off: texts aren't on for this one." : "Switched off.";
  const how = m.byHand ? "Sent by the account manager" : "On, sent automatically";
  return m.heldForOk ? `${how}, after you OK it on My Day.` : `${how}.`;
}

export function MessagesJourney({ messages, businessName, fromEmail }: { messages: SequenceMessage[]; businessName: string; fromEmail: string | null }) {
  // Emails that don't go wait behind a chip, so the main path is exactly
  // what a client gets. Every text is shown: none may be on yet, and the
  // point is to read them before switching any on.
  const steps: JourneyStep[] = messages.map((m) => ({
    key: m.key,
    path: m.channel,
    missed: m.channel === "email" && !m.on ? "off" : undefined,
    title: m.title,
    what: `${m.when}. ${status(m)}`,
    screen:
      m.channel === "email" ? (
        <div className={m.on ? "" : "opacity-60"}>
          <EmailPreview fromName={businessName} fromEmail={fromEmail} toName="Deanna Fields" subject={m.subject} text={m.body} />
        </div>
      ) : (
        <div className={m.on ? "" : "opacity-60"}>
          <TextPreview from={businessName} body={m.body} />
        </div>
      ),
  }));

  const on = messages.filter((m) => m.channel === "email" && m.on).length;
  const texts = messages.filter((m) => m.channel === "sms" && m.on).length;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
      <Link href="/my-day?tab=system" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ChevronLeft className="h-4 w-4" /> The system
      </Link>
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold">Emails and texts to the client</h1>
        <p className="text-sm text-muted-foreground">
          Everything a client gets from us without anybody typing it, in the order they get it: from booking the evaluation, through the
          visit, the proposal and the job, to the invoice. Each is shown as it arrives, with your wording and a sample client. Tap an email to
          read it full size. {on} email{on === 1 ? "" : "s"} and {texts} text{texts === 1 ? "" : "s"} are switched on. Nothing here sends.
        </p>
        <Link href="/admin/reminders" className="text-sm font-medium text-primary hover:underline">
          Change the wording, the timing, or what&apos;s switched on
        </Link>
      </header>
      <JourneyPages
        steps={steps}
        paths={[
          { key: "email", label: "Emails" },
          { key: "sms", label: "Texts" },
        ]}
        missed={messages.some((m) => m.channel === "email" && !m.on) ? [{ key: "off", label: "Switched off", path: "email" }] : []}
        heading="Add the emails that are switched off"
      />
    </div>
  );
}
