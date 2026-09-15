"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, Mail, MessageSquare, Search, Users } from "lucide-react";

import { Input } from "@/components/ui/input";
import { ChipRow } from "@/components/ui/chip-row";
import { ContactAvatar } from "@/components/ui/contact-avatar";
import { listDate, previewOf } from "@/lib/initials";
import { canMarkRead, countNeedsReply, needsReply, referenceLine } from "@/lib/needs-reply";
import { markConversationRead } from "@/lib/actions/conversation-read-actions";
import type { ConversationSummary } from "@/lib/data/conversations";

type View = "recent" | "needs_reply" | "oldest";

/** What one row is, as far as "is this waiting on us" is concerned. */
function replyState(conversation: ConversationSummary) {
  return {
    lastAuthorType: conversation.lastMessage.author_type,
    lastMessageAt: conversation.lastMessage.created_at,
    readThrough: conversation.readThrough,
  };
}

/**
 * An inbox: search at the top, a way to narrow it, then the rows.
 *
 * The rows are the point. A disc with initials, a badge saying how they got
 * in touch, the last thing said, who is carrying it, and when. All five of
 * those are answered before any of the words are read, which is how a phone
 * screen is actually used.
 */
export function InboxList({
  conversations,
  emptyLabel,
}: {
  conversations: ConversationSummary[];
  emptyLabel: string;
}) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("recent");
  // Cleared here as well as on the server, so the row leaves the list on the
  // tap rather than after a round trip on a phone signal.
  const [cleared, setCleared] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const now = new Date();

  const outstanding = conversations.filter(
    (c) => needsReply(replyState(c)) && !cleared.includes(`${c.jobId}:${c.channel}`)
  );

  const VIEWS: { value: View; label: string }[] = [
    { value: "recent", label: "Recent" },
    { value: "needs_reply", label: `Needs a reply (${countNeedsReply(outstanding.map(replyState))})` },
    { value: "oldest", label: "Oldest" },
  ];

  function clear(conversation: ConversationSummary) {
    const key = `${conversation.jobId}:${conversation.channel}`;
    setCleared((current) => [...current, key]);
    start(async () => {
      const result = await markConversationRead(
        conversation.jobId,
        conversation.channel,
        conversation.lastMessage.created_at
      );
      // Put it back rather than pretend: an inbox that quietly drops
      // something is the failure this whole screen exists to avoid.
      if (!result.ok) setCleared((current) => current.filter((k) => k !== key));
    });
  }

  // A filter, not a sort. It used to name a section that contained the whole
  // inbox, which is how somebody learns to stop reading the label.
  const base = view === "needs_reply" ? outstanding : conversations;

  const q = query.trim().toLowerCase();
  const matching = q
    ? base.filter((c) =>
        [c.customerName, c.propertyAddress, c.lastMessage.body, c.assignedToName ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(q)
      )
    : base;

  // Oldest first under "Needs a reply" too: the one that has been waiting
  // longest is the one somebody should open.
  const shown = [...matching].sort((a, b) => {
    const order = a.lastMessage.created_at.localeCompare(b.lastMessage.created_at);
    return view === "recent" ? -order : order;
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search conversations"
          className="h-12 rounded-xl pl-9"
        />
      </div>

      <ChipRow options={VIEWS} value={view} onChange={setView} />

      {shown.length === 0 ? (
        <p className="rounded-xl border border-border p-6 text-center text-sm text-muted-foreground">
          {q
            ? `Nothing matching "${query}".`
            : view === "needs_reply"
              ? "Nobody is waiting on you."
              : emptyLabel}
        </p>
      ) : (
        <ul className="flex flex-col">
          {shown.map((conversation) => {
            const key = `${conversation.jobId}:${conversation.channel}`;
            const waiting = needsReply(replyState(conversation)) && !cleared.includes(key);
            const reference = referenceLine(conversation.lastMessage.reference_label);
            return (
              <li key={key} className="border-b border-border/60">
                <Link
                  href={`/conversations/job/${conversation.jobId}`}
                  className="flex items-start gap-3 py-3 hover:bg-accent/30"
                >
                  <ContactAvatar
                    name={conversation.customerName || conversation.propertyAddress}
                    badge={conversation.channel === "internal" ? Users : MessageSquare}
                    badgeClass={
                      waiting ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    }
                  />

                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-[15px] font-semibold">
                        {conversation.customerName || conversation.propertyAddress}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {listDate(conversation.lastMessage.created_at, now)}
                      </span>
                    </span>

                    {/* What they were looking at when they wrote it. A
                        message from a proposal used to arrive with no way to
                        tell which area "can we skip that one?" meant. */}
                    {reference && (
                      <span className="mt-0.5 block truncate text-xs font-medium text-primary">
                        {reference}
                      </span>
                    )}

                    <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                      {previewOf(conversation.lastMessage.body)}
                    </span>

                    {conversation.assignedToName && (
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        Assigned to {conversation.assignedToName}
                      </span>
                    )}
                  </span>
                </Link>

                {/* For the answer that went out some other way — a phone call,
                    a conversation in a driveway. */}
                {canMarkRead(replyState(conversation)) && !cleared.includes(key) && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => clear(conversation)}
                    className="mb-2 flex items-center gap-1 text-xs font-semibold text-muted-foreground disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Mark as read
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The little legend for what a badge means, used where it is not obvious. */
export const CHANNEL_ICONS = { external: MessageSquare, internal: Users, email: Mail };
