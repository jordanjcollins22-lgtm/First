"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { cn } from "@/lib/utils";
import type { JobMessage, MessageAuthorType } from "@/types/domain";

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** A simple chronological thread with a composer — used for both the
 * team-only internal channel and the client-visible external one. Which
 * side a message aligns to is just "is this the viewer's own type or not,"
 * so the same component works whether the viewer is a team member or the
 * client. */
export function MessageThread({
  title,
  messages,
  onSend,
  viewerAuthorType,
  showNameField = false,
  nameValue,
  onNameChange,
  placeholder = "Write a message...",
  emptyLabel = "No messages yet.",
  footnote,
}: {
  title: string;
  messages: JobMessage[];
  onSend: (body: string) => Promise<void>;
  viewerAuthorType: MessageAuthorType;
  showNameField?: boolean;
  nameValue?: string;
  onNameChange?: (value: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  footnote?: string;
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSend() {
    if (!body.trim()) return;
    setError(null);
    startTransition(async () => {
      try {
        await onSend(body);
        setBody("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't send that.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <p className="font-semibold">{title}</p>

      <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                "flex max-w-[85%] flex-col gap-0.5 rounded-lg p-2.5 text-sm",
                m.author_type === viewerAuthorType ? "self-end bg-primary/10" : "self-start bg-muted/40"
              )}
            >
              <p className="whitespace-pre-wrap">{m.body}</p>
              <p className="text-[10px] text-muted-foreground">
                {m.author_name} · {formatTimestamp(m.created_at)}
              </p>
            </div>
          ))
        )}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex flex-col gap-2">
        {showNameField && (
          <Input
            value={nameValue ?? ""}
            onChange={(e) => onNameChange?.(e.target.value)}
            placeholder="Your name"
            className="h-9 text-sm"
          />
        )}
        <AutoTextarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={placeholder} rows={2} />
        <div className="flex items-center justify-between gap-2">
          {footnote ? <p className="text-[10px] text-muted-foreground">{footnote}</p> : <span />}
          <Button type="button" size="sm" disabled={isPending || !body.trim()} onClick={handleSend}>
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
