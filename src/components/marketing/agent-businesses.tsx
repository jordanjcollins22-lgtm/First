"use client";

import { useState, useTransition } from "react";
import { ExternalLink, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { removeAgentBusiness } from "@/lib/actions/outreach-agent-actions";
import type { BusinessRow } from "@/lib/data/post-sorter";
import { shortWhen } from "@/lib/time-zone";

/**
 * Businesses seen advertising in the groups: possible subcontractors.
 *
 * Only what they wrote in their own posts. One row per business however
 * many groups it posts in, with how often it has been seen and its latest
 * post a tap away. Filter by service to find, say, every tree company.
 */
export function AgentBusinesses({ rows }: { rows: BusinessRow[] }) {
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [pending, startTransition] = useTransition();

  const left = rows.filter((r) => !gone.has(r.id));
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? left.filter((r) => [r.name, r.person, r.area, ...r.services].some((v) => (v ?? "").toLowerCase().includes(needle)))
    : left;

  if (left.length === 0) {
    return <p className="text-sm text-muted-foreground">None yet. When it reads a post advertising someone&apos;s work, the business is kept here.</p>;
  }

  return (
    <div className="space-y-3">
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by service, name or town (tree, fence, Bel Air…)"
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
      <ul className="divide-y divide-border">
        {shown.map((row) => (
          <li key={row.id} className="space-y-1 py-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">
                {row.name ?? row.person ?? "Unnamed"}
                {row.name && row.person ? <span className="font-normal text-muted-foreground"> · {row.person}</span> : null}
              </span>
              <span className="text-xs text-muted-foreground">
                seen {row.timesSeen} time{row.timesSeen === 1 ? "" : "s"}, last {shortWhen(row.lastSeenAt)}
                {row.lastGroupName ? ` in ${row.lastGroupName}` : ""}
              </span>
            </div>
            {row.services.length > 0 && <p className="text-xs">{row.services.join(" · ")}</p>}
            <p className="flex flex-wrap gap-x-3 text-xs">
              {row.phone && <a href={`tel:${row.phone}`} className="underline">{row.phone}</a>}
              {row.email && <a href={`mailto:${row.email}`} className="underline">{row.email}</a>}
              {row.website && (
                <a href={/^https?:\/\//.test(row.website) ? row.website : `https://${row.website}`} target="_blank" rel="noreferrer" className="underline">
                  {row.website}
                </a>
              )}
              {row.area && <span className="text-muted-foreground">{row.area}</span>}
            </p>
            {row.lastPostText && <p className="line-clamp-2 text-xs text-muted-foreground">{row.lastPostText}</p>}
            <div className="flex gap-3 text-xs">
              {row.lastPostUrl && (
                <a href={row.lastPostUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
                  Their post <ExternalLink className="h-3 w-3" />
                </a>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-auto p-0 text-xs"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await removeAgentBusiness(row.id);
                    if (result.ok) setGone((s) => new Set(s).add(row.id));
                  })
                }
              >
                <Trash2 className="mr-1 h-3 w-3" /> Not worth keeping
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
