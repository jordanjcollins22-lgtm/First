"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { GROUP_PLATFORMS } from "@/lib/community-groups";
import { archiveGroup, saveGroup } from "@/lib/actions/community-group-actions";
import type { GroupRow } from "@/lib/data/community-groups";

/**
 * Making a group, or changing its rules.
 *
 * The two fields that matter are the price of a business post and the extra
 * words that mean "advert" around here. Everything else is a label.
 */
export function GroupEditor({
  group,
  onDone,
}: {
  group: GroupRow | null;
  onDone: () => void;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const [area, setArea] = useState(group?.area ?? "");
  const [platform, setPlatform] = useState(group?.platform ?? "facebook");
  const [externalUrl, setExternalUrl] = useState(group?.externalUrl ?? "");
  const [memberCount, setMemberCount] = useState(group?.memberCount?.toString() ?? "");
  const [businessPostDollars, setBusinessPostDollars] = useState(
    group?.businessPostCents != null ? (group.businessPostCents / 100).toString() : ""
  );
  const [passDays, setPassDays] = useState(group?.passDays?.toString() ?? "30");
  const [declineMessage, setDeclineMessage] = useState(group?.declineMessage ?? "");
  const [blockWords, setBlockWords] = useState((group?.blockWords ?? []).join("\n"));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      const result = await saveGroup({
        id: group?.id ?? null,
        name,
        area,
        platform,
        externalUrl,
        memberCount,
        businessPostDollars,
        passDays,
        declineMessage,
        blockWords,
      });
      if (!result.ok) return setError(result.error);
      onDone();
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">Group name</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bel Air South Neighbours" className="h-10" />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">
          Area it covers{" "}
          <span className="font-normal text-muted-foreground">
            The smaller the better. This is the whole reason it works.
          </span>
        </span>
        <Input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Bel Air South, 21015" className="h-10" />
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">Where is it?</span>
        <div className="flex flex-wrap gap-1.5">
          {GROUP_PLATFORMS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setPlatform(option.key)}
              className={cn(
                "min-h-9 rounded-full border px-3 text-xs",
                platform === option.key
                  ? "border-primary bg-primary/10 font-medium text-primary"
                  : "border-border text-muted-foreground hover:bg-accent"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">
          Link to it <span className="font-normal text-muted-foreground">Optional</span>
        </span>
        <Input value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="https://facebook.com/groups/…" className="h-10" />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Members</span>
          <Input value={memberCount} onChange={(e) => setMemberCount(e.target.value)} inputMode="numeric" className="h-10" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Pass lasts (days)</span>
          <Input value={passDays} onChange={(e) => setPassDays(e.target.value)} inputMode="numeric" className="h-10" />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">
          A business post costs{" "}
          <span className="font-normal text-muted-foreground">
            Leave blank and the answer to a business is just no.
          </span>
        </span>
        <Input
          value={businessPostDollars}
          onChange={(e) => setBusinessPostDollars(e.target.value)}
          inputMode="decimal"
          placeholder="25"
          className="h-10"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">
          Words that mean &ldquo;advert&rdquo; here{" "}
          <span className="font-normal text-muted-foreground">
            One per line, on top of the standard list. Local trades, local slogans.
          </span>
        </span>
        <Textarea value={blockWords} onChange={(e) => setBlockWords(e.target.value)} rows={4} className="font-mono text-xs" />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">
          What a declined business is told{" "}
          <span className="font-normal text-muted-foreground">
            Leave blank for the standard wording. The pay link is added on the end.
          </span>
        </span>
        <Textarea value={declineMessage} onChange={(e) => setDeclineMessage(e.target.value)} rows={3} className="text-sm" />
      </label>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={submit} disabled={pending}>
          {pending ? "Saving…" : group ? "Save changes" : "Create the group"}
        </Button>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        {group && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await archiveGroup({ id: group.id, archived: !group.archivedAt });
                onDone();
              })
            }
            className="ml-auto text-xs text-muted-foreground underline"
          >
            {group.archivedAt ? "Bring it back" : "Archive it"}
          </button>
        )}
      </div>
    </div>
  );
}
