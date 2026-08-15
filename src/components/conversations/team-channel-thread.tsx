"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { postTeamMessage, setTeamChannelMember } from "@/lib/actions/team-channel-actions";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { TeamChannelWithMembers, TeamMessage } from "@/types/domain";

interface TeamMember {
  id: string;
  name: string;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function TeamChannelThread({
  channel,
  messages: initialMessages,
  currentProfileId,
  teamMembers,
}: {
  channel: TeamChannelWithMembers;
  messages: TeamMessage[];
  currentProfileId: string;
  teamMembers: TeamMember[];
}) {
  // Messages that landed since this page was rendered — from Realtime, or
  // from this person's own send. Kept separate from the server's list and
  // merged at render time rather than copied into state, so a fresh server
  // render can never replace what has already arrived.
  const [liveMessages, setLiveMessages] = useState<TeamMessage[]>([]);

  const messages = useMemo(() => {
    const fromServer = new Set(initialMessages.map((m) => m.id));
    const extra = liveMessages.filter((m) => !fromServer.has(m.id));
    if (extra.length === 0) return initialMessages;
    return [...initialMessages, ...extra].sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [initialMessages, liveMessages]);

  const addLiveMessage = useCallback((incoming: TeamMessage) => {
    setLiveMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]));
  }, []);
  const [body, setBody] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [memberIds, setMemberIds] = useState<string[]>(channel.memberIds);
  const [showMembers, setShowMembers] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isMember = memberIds.includes(currentProfileId);

  // Live updates instead of waiting for a refresh. Realtime applies the same
  // members-only RLS policy, so a non-member's subscription simply never
  // fires. Guarded against duplicates because the sender's own insert comes
  // back over the socket too.
  useEffect(() => {
    const supabase = createClient();
    const subscription = supabase
      .channel(`team_messages:${channel.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "team_messages",
          filter: `channel_id=eq.${channel.id}`,
        },
        (payload) => {
          addLiveMessage(payload.new as TeamMessage);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [channel.id, addLiveMessage]);

  // Follow the conversation as it grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function handleSend() {
    if (!body.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await postTeamMessage(channel.id, body);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      // Don't wait on Realtime to echo it back.
      addLiveMessage(result.message);
      setBody("");
    });
  }

  function toggleMember(profileId: string) {
    const nextIsMember = !memberIds.includes(profileId);
    setMemberIds((prev) => (nextIsMember ? [...prev, profileId] : prev.filter((id) => id !== profileId)));
    setError(null);
    startTransition(async () => {
      const result = await setTeamChannelMember(channel.id, profileId, nextIsMember);
      if (!result.ok) {
        setMemberIds((prev) => (nextIsMember ? prev.filter((id) => id !== profileId) : [...prev, profileId]));
        setError(result.message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-2xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">
            {memberIds.length} member{memberIds.length === 1 ? "" : "s"}
          </p>
          <div className="flex gap-2">
            {isMember && (
              <Button type="button" size="sm" asChild>
                <Link href={`/conversations/${channel.id}/call`}>
                  <Video className="h-3.5 w-3.5" />
                  Start call
                </Link>
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => setShowMembers((v) => !v)}>
              {showMembers ? "Done" : "Manage members"}
            </Button>
          </div>
        </div>
        {showMembers ? (
          <div className="flex flex-wrap gap-2">
            {teamMembers.map((member) => {
              const selected = memberIds.includes(member.id);
              return (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => toggleMember(member.id)}
                  disabled={isPending}
                  className={cn(
                    "rounded-lg border px-2.5 py-1 text-xs transition-colors",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card/60 hover:bg-accent"
                  )}
                >
                  {member.name}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {memberIds
              .map((id) => teamMembers.find((m) => m.id === id)?.name)
              .filter(Boolean)
              .join(", ") || "Nobody yet."}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
        <div ref={scrollRef} className="flex max-h-96 flex-col gap-2 overflow-y-auto">
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {isMember ? "No messages yet — say something." : "Add yourself as a member to see and post messages."}
            </p>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "flex max-w-[85%] flex-col gap-0.5 rounded-lg p-2.5 text-sm",
                  m.author_profile_id === currentProfileId ? "self-end bg-primary/10" : "self-start bg-muted/40"
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
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={isMember ? "Message the group..." : "Add yourself as a member to post"}
            rows={2}
            disabled={!isMember}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-muted-foreground">Team only — the client never sees this.</p>
            <Button type="button" size="sm" disabled={isPending || !isMember || !body.trim()} onClick={handleSend}>
              Send
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
