"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { dollars, passStatusLabel, URGENCIES } from "@/lib/community-groups";
import { markPassUsed, markPostHandled } from "@/lib/actions/community-group-actions";
import { AdminAssistCard } from "@/components/groups/admin-assist-card";
import { GroupEditor } from "@/components/groups/group-editor";
import { PostTriage } from "@/components/groups/post-triage";
import type { GroupBoard, GroupRow, PassRow, PostRow } from "@/lib/data/community-groups";

/**
 * The groups, on one screen.
 *
 * Ordered by what somebody came here to do. Requests nobody answered are at
 * the top because they are the only thing on this page with a clock on it: a
 * neighbour who asked on Tuesday has hired somebody else by Thursday. Sorting
 * a new post is next, then the groups themselves, then the money.
 */
export function GroupBoardView({ board, baseUrl }: { board: GroupBoard; baseUrl: string }) {
  const [tab, setTab] = useState<"open" | "sort" | "groups" | "money">(
    board.open.length > 0 ? "open" : board.groups.length === 0 ? "groups" : "sort"
  );

  const tabs = [
    { key: "open" as const, label: `To answer${board.open.length ? ` (${board.open.length})` : ""}` },
    { key: "sort" as const, label: "Sort a post" },
    { key: "groups" as const, label: "Groups" },
    { key: "money" as const, label: "Paid posts" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1.5">
        {tabs.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => setTab(option.key)}
            className={cn(
              "min-h-9 rounded-full border px-3 text-xs",
              tab === option.key
                ? "border-primary bg-primary/10 font-medium text-primary"
                : "border-border text-muted-foreground hover:bg-accent"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {tab === "open" && <OpenRequests posts={board.open} />}
      {tab === "sort" && (
        <section className="rounded-lg border border-border p-4">
          <h2 className="mb-3 text-sm font-semibold">Sort a post</h2>
          <PostTriage groups={board.groups} services={board.services} />
        </section>
      )}
      {tab === "groups" && <Groups groups={board.groups} baseUrl={baseUrl} />}
      {tab === "money" && <Passes passes={board.passes} groups={board.groups} />}
    </div>
  );
}

function OpenRequests({ posts }: { posts: PostRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  if (posts.length === 0) {
    return (
      <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
        Nothing waiting. Every request somebody sorted has been answered.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {posts.map((post) => (
        <li key={post.id} className="rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-sm font-medium">{post.authorName ?? "Somebody"}</span>
            <span className="text-xs text-muted-foreground">{post.groupName}</span>
            {post.urgency && (
              <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
                {URGENCIES.find((u) => u.key === post.urgency)?.label}
              </span>
            )}
            {post.service && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                {post.service}
              </span>
            )}
          </div>

          <p className="mt-1 text-sm">{post.summary || post.postedText?.slice(0, 200) || "No detail written down."}</p>

          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await markPostHandled({ id: post.id, note: "", handled: true });
                  router.refresh();
                })
              }
              className="min-h-8 rounded-md border border-border px-2.5 text-xs hover:bg-accent"
            >
              Answered
            </button>
            <span className="text-xs text-muted-foreground">
              {new Date(post.postedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Groups({ groups, baseUrl }: { groups: GroupRow[]; baseUrl: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(groups.length === 0);

  function done() {
    setEditing(null);
    setAdding(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {adding ? (
        <GroupEditor group={null} onDone={done} />
      ) : (
        <Button type="button" variant="outline" onClick={() => setAdding(true)} className="self-start">
          <Plus className="mr-1.5 h-4 w-4" />
          New group
        </Button>
      )}

      {groups.map((group) =>
        editing === group.id ? (
          <GroupEditor key={group.id} group={group} onDone={done} />
        ) : (
          <div key={group.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-sm font-semibold">{group.name}</span>
              {group.area && <span className="text-xs text-muted-foreground">{group.area}</span>}
              {group.archivedAt && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">Archived</span>
              )}
              <button
                type="button"
                onClick={() => setEditing(group.id)}
                className="ml-auto text-xs text-muted-foreground underline"
              >
                Edit
              </button>
            </div>

            <p className="text-xs text-muted-foreground">
              {group.memberCount ? `${group.memberCount.toLocaleString()} members. ` : ""}
              {group.tally.requests} request{group.tally.requests === 1 ? "" : "s"}
              {group.tally.unanswered > 0 ? `, ${group.tally.unanswered} unanswered` : ""}.{" "}
              {group.tally.promotions} advert{group.tally.promotions === 1 ? "" : "s"} caught.{" "}
              {group.businessPostCents == null
                ? "Business posts not for sale."
                : `${dollars(group.businessPostCents)} a post, ${dollars(group.tally.earnedCents)} taken.`}
            </p>

            {group.externalUrl && (
              <a
                href={group.externalUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs underline"
              >
                Open the group <ExternalLink className="h-3 w-3" />
              </a>
            )}

            <AdminAssistCard
              group={group}
              payLink={group.businessPostCents == null ? null : `${baseUrl}/promote/${group.id}`}
            />
          </div>
        )
      )}
    </div>
  );
}

function Passes({ passes, groups }: { passes: PassRow[]; groups: GroupRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const earned = groups.reduce((sum, group) => sum + group.tally.earnedCents, 0);

  if (passes.length === 0) {
    return (
      <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
        Nobody has paid to post yet. Put a price on a group and the decline message gets somewhere
        to send them.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">{dollars(earned)} taken from business posts.</p>
      {passes.map((pass) => (
        <div key={pass.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border p-3">
          <span className="text-sm font-medium">{pass.businessName}</span>
          <span className="text-xs text-muted-foreground">{pass.groupName}</span>
          <span className="font-mono text-xs font-semibold tracking-widest">{pass.code.toUpperCase()}</span>
          <span className="text-xs text-muted-foreground">
            {passStatusLabel({ status: pass.status, expiresAt: pass.expiresAt })}
          </span>
          <span className="ml-auto text-xs">{dollars(pass.amountCents)}</span>
          {pass.status === "paid" && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await markPassUsed({ id: pass.id });
                  router.refresh();
                })
              }
              className="min-h-8 rounded-md border border-border px-2.5 text-xs hover:bg-accent"
            >
              They posted
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
