"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronUp, MessageSquare, Send, User, Users } from "lucide-react";

import { AutoTextarea } from "@/components/ui/auto-textarea";
import { ContactAvatar } from "@/components/ui/contact-avatar";
import { channelLabel, groupByDay, messageTime, reachLine, type ThreadMessage } from "@/lib/message-thread";
import { postJobMessage } from "@/lib/actions/job-message-actions";

/**
 * One conversation, as a conversation.
 *
 * Days are headed, so scrolling back through a long thread lands somewhere.
 * Each bubble says how it went out and when, because a thread that mixes a
 * text, a team note and something the client can read on their proposal is
 * unreadable unless each one says which it is.
 *
 * The composer names the channel before anything is typed. "Message the
 * client" means a text at one business and an email at another, and somebody
 * writing should know which before they press send, not after.
 */
export function ClientThread({
  jobId,
  customerName,
  propertyAddress,
  customerId,
  phone,
  email,
  smsReady,
  messages,
}: {
  jobId: string;
  customerName: string;
  propertyAddress: string;
  customerId: string | null;
  phone: string | null;
  email: string | null;
  smsReady: boolean;
  messages: ThreadMessage[];
}) {
  const [channel, setChannel] = useState<"external" | "internal">("external");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const days = groupByDay(messages, new Date());

  function send() {
    if (!body.trim()) return;
    setError(null);
    const text = body;
    start(async () => {
      try {
        await postJobMessage(jobId, channel, text);
        setBody("");
      } catch {
        setError("That did not send. Try again.");
      }
    });
  }

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Who, and one tap to everything else about them. */}
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card/80 px-3 py-2.5 backdrop-blur-xl">
        <Link href="/conversations" aria-label="Back to conversations" className="shrink-0 p-1">
          <ChevronLeft className="h-5 w-5" />
        </Link>

        <ContactAvatar name={customerName || propertyAddress} badge={MessageSquare} size="sm" />

        <Link
          href={customerId ? `/clients/${customerId}` : `/jobs/${jobId}`}
          className="min-w-0 flex-1"
        >
          <span className="block truncate text-[15px] font-semibold">
            {customerName || propertyAddress}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            Tap to view contact info
          </span>
        </Link>

        <Link
          href={`/jobs/${jobId}`}
          aria-label="Open the job"
          className="shrink-0 rounded-lg border border-border p-2"
        >
          <User className="h-4 w-4" />
        </Link>
      </header>

      <div className="flex-1 px-3 py-4">
        {days.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Nothing said yet. Start below.
          </p>
        ) : (
          days.map((day) => (
            <div key={day.date} className="mb-4">
              <p className="mx-auto mb-3 w-fit rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                {day.label}
              </p>

              <div className="flex flex-col gap-3">
                {day.messages.map((message) => (
                  <div
                    key={message.id}
                    className={`max-w-[85%] rounded-2xl p-3 ${
                      message.fromClient
                        ? "self-start rounded-bl-sm bg-muted"
                        : message.channel === "internal"
                          ? "self-end rounded-br-sm border border-dashed border-border bg-card"
                          : "self-end rounded-br-sm bg-primary/10"
                    }`}
                  >
                    <p className="text-[11px] text-muted-foreground">
                      {channelLabel(message.channel)} · {messageTime(message.createdAt)}
                      {message.fromClient ? "" : ` · ${message.authorName}`}
                    </p>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm">{message.body}</p>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* The composer, with the channel it will use named on it. */}
      <div className="sticky bottom-0 border-t border-border bg-card/90 p-3 backdrop-blur-xl">
        {pickerOpen && (
          <div className="mb-2 overflow-hidden rounded-xl border border-border">
            {(["external", "internal"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setChannel(option);
                  setPickerOpen(false);
                }}
                className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm ${
                  channel === option ? "bg-primary/10 font-semibold" : ""
                }`}
              >
                {option === "external" ? (
                  <MessageSquare className="h-4 w-4 shrink-0" />
                ) : (
                  <Users className="h-4 w-4 shrink-0" />
                )}
                {option === "external" ? "Message the client" : "Note for the team"}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <button
            type="button"
            aria-label="Choose where this goes"
            onClick={() => setPickerOpen((v) => !v)}
            className="flex h-10 shrink-0 items-center gap-1 rounded-full bg-primary/10 px-3 text-primary"
          >
            {channel === "external" ? (
              <MessageSquare className="h-4 w-4" />
            ) : (
              <Users className="h-4 w-4" />
            )}
            <ChevronUp className={`h-3 w-3 transition-transform ${pickerOpen ? "rotate-180" : ""}`} />
          </button>

          <AutoTextarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={1}
            placeholder={channel === "external" ? "Message the client…" : "Note for the team…"}
            className="min-h-10 flex-1 py-2.5"
          />

          <button
            type="button"
            aria-label="Send"
            disabled={pending || !body.trim()}
            onClick={send}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {reachLine({ channel, phone, email, smsReady })}
        </p>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
