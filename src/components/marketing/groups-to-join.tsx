"use client";

import { useState, useTransition } from "react";
import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { dismissGroupToJoin, markGroupJoined } from "@/lib/actions/outreach-agent-actions";
import type { GroupRow } from "@/lib/data/outreach-agent";
import { shortWhen } from "@/lib/time-zone";

/**
 * Groups the agent found leads in that the account has not joined.
 *
 * Most leads first, because that is the order to join them in. Joining is
 * a person's job: local groups ask questions at the door and admins look
 * at who is knocking. Once joined, the group's posts flow through the feed
 * and get answered like any other.
 */
export function GroupsToJoin({ groups }: { groups: GroupRow[] }) {
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const shown = groups.filter((g) => !gone.has(g.id));
  if (shown.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing yet. When search finds a lead in a group you&apos;re not in, it shows here.</p>;
  }

  function act(id: string, what: "joined" | "dismiss") {
    setMessage(null);
    startTransition(async () => {
      const result = what === "joined" ? await markGroupJoined(id) : await dismissGroupToJoin(id);
      if (result.ok) setGone((s) => new Set(s).add(id));
      else setMessage(result.error);
    });
  }

  return (
    <div className="space-y-2">
      <ul className="divide-y divide-border">
        {shown.map((group) => (
          <li key={group.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <div className="min-w-0">
              <a href={group.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium underline">
                {group.name ?? group.groupKey}
                <ExternalLink className="h-3 w-3" />
              </a>
              <p className="text-xs text-muted-foreground">
                {group.postsFound} lead{group.postsFound === 1 ? "" : "s"} seen
                {group.lastPostAt ? `, last ${shortWhen(group.lastPostAt)}` : ""}
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" disabled={pending} onClick={() => act(group.id, "joined")}>
                I joined
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => act(group.id, "dismiss")}>
                Not interested
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}
