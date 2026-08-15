"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { MessageSquare, Plus, Users } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createTeamChannel } from "@/lib/actions/team-channel-actions";
import { cn } from "@/lib/utils";
import type { ConversationSummary } from "@/lib/data/conversations";
import type { TeamChannelWithMembers } from "@/types/domain";

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const CARD =
  "flex flex-col gap-1 rounded-2xl border border-white/60 bg-card/70 p-4 shadow-lg shadow-black/5 backdrop-blur-xl backdrop-saturate-150 hover:bg-accent/40";

function ClientConversations({ conversations }: { conversations: ConversationSummary[] }) {
  if (conversations.length === 0) {
    return (
      <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <MessageSquare className="h-4 w-4" />
        No client conversations yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 pt-2">
      {conversations.map((c) => (
        <Link key={`${c.jobId}-${c.channel}`} href={`/jobs/${c.jobId}`} className={CARD}>
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold">{c.customerName || c.propertyAddress}</p>
            <span className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              Client
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{c.propertyAddress}</p>
          <p className="truncate text-sm">
            <span className="text-muted-foreground">{c.lastMessage.author_name}: </span>
            {c.lastMessage.body}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatTimestamp(c.lastMessage.created_at)} · {c.messageCount} message
            {c.messageCount === 1 ? "" : "s"}
          </p>
        </Link>
      ))}
    </div>
  );
}

function NewGroupForm() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleAdd() {
    setError(null);
    startTransition(async () => {
      const result = await createTeamChannel(name, description);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setName("");
      setDescription("");
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} className="self-start">
        <Plus className="h-4 w-4" />
        New group
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-muted/30 p-3">
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Group name (e.g. Crew 1, Office)"
        className="h-9 text-sm"
      />
      <Input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What this group is for (optional)"
        className="h-9 text-sm"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={handleAdd} disabled={isPending || !name.trim()}>
          {isPending ? "Creating..." : "Create group"}
        </Button>
      </div>
    </div>
  );
}

function InternalConversations({
  channels,
  jobNotes,
  currentProfileId,
}: {
  channels: TeamChannelWithMembers[];
  jobNotes: ConversationSummary[];
  currentProfileId: string;
}) {
  return (
    <div className="flex flex-col gap-4 pt-2">
      <NewGroupForm />

      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Groups</p>
        {channels.length === 0 ? (
          <p className="text-sm text-muted-foreground">No groups yet — create one to start a team thread.</p>
        ) : (
          channels.map((channel) => {
            const isMember = channel.memberIds.includes(currentProfileId);
            return (
              <Link key={channel.id} href={`/conversations/${channel.id}`} className={CARD}>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold">{channel.name}</p>
                  <span
                    className={cn(
                      "flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                      isMember
                        ? "border-border bg-muted text-muted-foreground"
                        : "border-amber-400/40 bg-amber-400/10 text-amber-700"
                    )}
                  >
                    <Users className="h-3 w-3" />
                    {isMember ? `${channel.memberIds.length} member${channel.memberIds.length === 1 ? "" : "s"}` : "Not a member"}
                  </span>
                </div>
                {channel.description && <p className="text-xs text-muted-foreground">{channel.description}</p>}
                {channel.lastMessage ? (
                  <>
                    <p className="truncate text-sm">
                      <span className="text-muted-foreground">{channel.lastMessage.author_name}: </span>
                      {channel.lastMessage.body}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatTimestamp(channel.lastMessage.created_at)} · {channel.messageCount} message
                      {channel.messageCount === 1 ? "" : "s"}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {isMember ? "No messages yet." : "Join to see this group's messages."}
                  </p>
                )}
              </Link>
            );
          })
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Job notes</p>
        {jobNotes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No internal job notes yet.</p>
        ) : (
          jobNotes.map((c) => (
            <Link key={`${c.jobId}-${c.channel}`} href={`/jobs/${c.jobId}`} className={CARD}>
              <p className="font-semibold">{c.customerName || c.propertyAddress}</p>
              <p className="text-xs text-muted-foreground">{c.propertyAddress}</p>
              <p className="truncate text-sm">
                <span className="text-muted-foreground">{c.lastMessage.author_name}: </span>
                {c.lastMessage.body}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatTimestamp(c.lastMessage.created_at)} · {c.messageCount} message
                {c.messageCount === 1 ? "" : "s"}
              </p>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

export function ConversationsView({
  conversations,
  channels,
  currentProfileId,
}: {
  conversations: ConversationSummary[];
  channels: TeamChannelWithMembers[];
  currentProfileId: string;
}) {
  const external = conversations.filter((c) => c.channel === "external");
  const jobNotes = conversations.filter((c) => c.channel === "internal");

  return (
    <Tabs defaultValue="internal">
      <TabsList>
        <TabsTrigger value="internal">Internal</TabsTrigger>
        <TabsTrigger value="external">External</TabsTrigger>
      </TabsList>
      <TabsContent value="internal">
        <InternalConversations channels={channels} jobNotes={jobNotes} currentProfileId={currentProfileId} />
      </TabsContent>
      <TabsContent value="external">
        <ClientConversations conversations={external} />
      </TabsContent>
    </Tabs>
  );
}
