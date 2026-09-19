"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronUp, Mail, MessageSquare, Send, Smartphone, User, Users } from "lucide-react";

import { AutoTextarea } from "@/components/ui/auto-textarea";
import { ContactAvatar } from "@/components/ui/contact-avatar";
import { channelLabel, groupByDay, messageTime, type ThreadMessage } from "@/lib/message-thread";
import {
  defaultVia,
  HOW_THEY_REPLY,
  viaOptions,
  viaReachLine,
  type MessageVia,
  type ViaFacts,
} from "@/lib/message-via";
import { postJobMessage, sendClientMessageVia } from "@/lib/actions/job-message-actions";
import { referenceLine } from "@/lib/needs-reply";
import { SuggestBar } from "@/components/conversations/suggest-bar";

/**
 * One conversation, as a conversation.
 *
 * Days are headed, so scrolling back through a long thread lands somewhere.
 * Each bubble says how it went out and when, because a thread that mixes a
 * text, a team note and something the client can read on their proposal is
 * unreadable unless each one says which it is.
 *
 * The composer names the channel before anything is typed, and for the
 * client it names the way: on their page, by email, or by text. The three are
 * always shown, greyed with the reason when one cannot be used, so "why can't
 * I text them" is answered on the button rather than in a support call.
 *
 * Under the box, the fact the office keeps forgetting: a client can write back
 * from their page or by email, and a text to the office phone never lands here.
 */
export function ClientThread({
  jobId,
  customerName,
  propertyAddress,
  customerId,
  phone,
  email,
  smsReady,
  emailReady,
  clientLink,
  messages,
}: {
  jobId: string;
  customerName: string;
  propertyAddress: string;
  customerId: string | null;
  phone: string | null;
  email: string | null;
  smsReady: boolean;
  emailReady: boolean;
  clientLink: string | null;
  messages: ThreadMessage[];
}) {
  const facts: ViaFacts = { phone, email, smsReady, emailReady, clientLink };
  const [channel, setChannel] = useState<"external" | "internal">("external");
  const [via, setVia] = useState<MessageVia>(() => defaultVia(facts));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const days = groupByDay(messages, new Date());
  const options = viaOptions(facts);

  function send() {
    if (!body.trim()) return;
    setError(null);
    setNote(null);
    const text = body;
    start(async () => {
      try {
        if (channel === "external") {
          const result = await sendClientMessageVia(jobId, text, via);
          // Saved either way. What did not happen is said, not swallowed.
          if (!result.delivered && result.note) setNote(result.note);
        } else {
          await postJobMessage(jobId, channel, text);
        }
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
                      {channelLabel(message.channel, message.via, message.fromClient)} · {messageTime(message.createdAt)}
                      {message.fromClient ? "" : ` · ${message.authorName}`}
                    </p>
                    {referenceLine(message.reference) && (
                      <p className="mt-1 text-[11px] font-semibold text-primary">
                        {referenceLine(message.reference)}
                      </p>
                    )}
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
        {/* Drafts, only when asked for. Tapping one fills the box below;
            nothing is sent until somebody presses send. */}
        <SuggestBar jobId={jobId} onPick={setBody} />

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

        {/* The way out, only when it is going to the client. Three buttons,
            always, so the switch never jumps under a thumb. */}
        {channel === "external" && (
          <div className="mb-2 flex gap-1.5" role="radiogroup" aria-label="How to send this">
            {options.map((option) => {
              const Icon = option.via === "email" ? Mail : option.via === "sms" ? Smartphone : MessageSquare;
              const on = via === option.via;
              return (
                <button
                  key={option.via}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={!option.available}
                  title={option.reason ?? undefined}
                  onClick={() => setVia(option.via)}
                  className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold ${
                    on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground"
                  } disabled:opacity-40`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {option.label}
                </button>
              );
            })}
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
          {channel === "internal" ? "Only the team sees this." : viaReachLine(via, facts)}
        </p>
        {channel === "external" && (
          <>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{HOW_THEY_REPLY}</p>
            {options
              .filter((o) => !o.available && o.reason)
              .map((o) => (
                <p key={o.via} className="mt-0.5 text-[11px] text-muted-foreground">
                  {o.label}: {o.reason}
                </p>
              ))}
          </>
        )}
        {note && <p className="mt-1 text-xs font-semibold text-amber-700">{note}</p>}
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
