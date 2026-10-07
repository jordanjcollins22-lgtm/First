"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { CopyButton } from "@/components/groups/copy-button";
import { adminAssistPlan } from "@/lib/community-groups";
import type { GroupRow } from "@/lib/data/community-groups";

/**
 * The settings to paste into Facebook, for one group.
 *
 * This is the honest shape of "block businesses from posting". Facebook
 * discontinued the Groups API on 22 April 2024: no app can read a group's
 * pending posts, decline one, or message the person who wrote it, and being
 * the owner of the group changes none of that.
 *
 * What Facebook kept is Admin Assist, which declines posts on keywords and
 * shows the author a message the admin wrote. So the words and the message
 * live here, where they can be edited and priced, and this card hands them
 * over in the form the Facebook boxes want. Set up once per group.
 */
export function AdminAssistCard({ group, payLink }: { group: GroupRow; payLink: string | null }) {
  const [open, setOpen] = useState(false);
  const plan = adminAssistPlan(
    {
      name: group.name,
      businessPostCents: group.businessPostCents,
      passDays: group.passDays,
      declineMessage: group.declineMessage,
    },
    group.blockWords,
    payLink
  );

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Block business posts in {group.name}
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          {plan.keywords.length} words
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t border-border p-3">
          <p className="text-xs text-muted-foreground">
            Facebook stopped letting apps touch groups in April 2024, so the blocking runs on
            Facebook rather than in here. Their Admin Assist does it, and these are its settings.
            Paste them in once and it runs on every post from then on.
          </p>

          <ol className="flex list-decimal flex-col gap-1 pl-4 text-xs text-muted-foreground">
            {plan.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">Words to decline on</span>
              <CopyButton text={plan.keywords.join("\n")} label="Copy all" />
            </div>
            <pre className="max-h-40 overflow-auto rounded-md border border-border bg-muted/40 p-2 text-[11px] leading-5">
              {plan.keywords.join("\n")}
            </pre>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">What they are told</span>
              <CopyButton text={plan.declineMessage} />
            </div>
            <p className="rounded-md border border-border bg-muted/40 p-2 text-xs leading-5">
              {plan.declineMessage}
            </p>
          </div>

          {payLink && (
            <div className="flex items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 p-2">
              <div className="min-w-0">
                <p className="text-xs font-medium">Their link to pay</p>
                <p className="truncate text-[11px] text-muted-foreground">{payLink}</p>
              </div>
              <CopyButton text={payLink} />
            </div>
          )}

          {!payLink && (
            <p className="text-xs text-muted-foreground">
              Set a price on this group and the message gets somewhere to send them.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
