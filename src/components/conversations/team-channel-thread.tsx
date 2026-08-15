"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { postTeamMessage, setTeamChannelMember } from "@/lib/actions/team-channel-actions";
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
  messages,
  currentProfileId,
  teamMembers,
}: {
  channel: TeamChannelWithMembers;
  messages: TeamMessage[];
  currentProfileId: string;
  teamMembers: TeamMember[];
}) {
  const [body, setBody] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>(channel.memberIds);
  const [showMembers, setShowMembers] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isMember = memberIds.includes(currentProfileId);

  function handleSend() {
    if (!body.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await postTeamMessage(channel.id, body);
      if (!result.ok) {
        setError(result.message);
        return;
      }
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
          <Button type="button" variant="outline" size="sm" onClick={() => setShowMembers((v) => !v)}>
            {showMembers ? "Done" : "Manage members"}
          </Button>
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
        <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
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
