"use client";

import { useState } from "react";
import Link from "next/link";
import { Mail, MessageSquare, Search, Users } from "lucide-react";

import { Input } from "@/components/ui/input";
import { ChipRow } from "@/components/ui/chip-row";
import { ContactAvatar } from "@/components/ui/contact-avatar";
import { listDate, previewOf } from "@/lib/initials";
import type { ConversationSummary } from "@/lib/data/conversations";

type Sort = "recent" | "needs_reply" | "oldest";

const SORTS: { value: Sort; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "needs_reply", label: "Needs a reply" },
  { value: "oldest", label: "Oldest" },
];

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
  const [sort, setSort] = useState<Sort>("recent");
  const now = new Date();

  const q = query.trim().toLowerCase();
  const matching = q
    ? conversations.filter((c) =>
        [c.customerName, c.propertyAddress, c.lastMessage.body, c.assignedToName ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(q)
      )
    : conversations;

  // "Needs a reply" is the client having spoken last. Sorted rather than
  // filtered away, so the count on screen is still the whole inbox.
  const shown = [...matching].sort((a, b) => {
    if (sort === "needs_reply") {
      const aWaiting = a.lastMessage.author_type === "client" ? 0 : 1;
      const bWaiting = b.lastMessage.author_type === "client" ? 0 : 1;
      if (aWaiting !== bWaiting) return aWaiting - bWaiting;
    }
    const order = a.lastMessage.created_at.localeCompare(b.lastMessage.created_at);
    return sort === "oldest" ? order : -order;
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

      <ChipRow options={SORTS} value={sort} onChange={setSort} />

      {shown.length === 0 ? (
        <p className="rounded-xl border border-border p-6 text-center text-sm text-muted-foreground">
          {q ? `Nothing matching "${query}".` : emptyLabel}
        </p>
      ) : (
        <ul className="flex flex-col">
          {shown.map((conversation) => {
            const waiting = conversation.lastMessage.author_type === "client";
            return (
              <li key={`${conversation.jobId}:${conversation.channel}`}>
                <Link
                  href={`/conversations/job/${conversation.jobId}`}
                  className="flex items-start gap-3 border-b border-border/60 py-3 hover:bg-accent/30"
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
