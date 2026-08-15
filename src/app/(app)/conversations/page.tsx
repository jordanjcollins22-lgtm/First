import Link from "next/link";
import { MessageSquare } from "lucide-react";

import { isSupabaseConfigured } from "@/lib/env";
import { listConversations } from "@/lib/data/conversations";
import { cn } from "@/lib/utils";

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function ConversationsPage() {
  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-muted-foreground">Supabase is not configured yet.</p>
      </div>
    );
  }

  const conversations = await listConversations();

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Conversations</h1>
      <p className="mb-6 text-muted-foreground">Every internal note and client message, most recently active first.</p>

      {conversations.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <MessageSquare className="h-4 w-4" />
          No conversations yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {conversations.map((c) => (
            <Link
              key={`${c.jobId}-${c.channel}`}
              href={`/jobs/${c.jobId}`}
              className="flex flex-col gap-1 rounded-2xl border border-white/60 bg-card/70 p-4 shadow-lg shadow-black/5 backdrop-blur-xl backdrop-saturate-150 hover:bg-accent/40"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">{c.customerName || c.propertyAddress}</p>
                <span
                  className={cn(
                    "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                    c.channel === "internal"
                      ? "border-border bg-muted text-muted-foreground"
                      : "border-primary/40 bg-primary/10 text-primary"
                  )}
                >
                  {c.channel === "internal" ? "Internal" : "Client"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{c.propertyAddress}</p>
              <p className="truncate text-sm">
                <span className="text-muted-foreground">{c.lastMessage.author_name}: </span>
                {c.lastMessage.body}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatTimestamp(c.lastMessage.created_at)} · {c.messageCount} message{c.messageCount === 1 ? "" : "s"}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
