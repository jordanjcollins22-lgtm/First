import { ChevronDown } from "lucide-react";

import { ReferralMessageCard } from "@/components/v2/panels/role/referral-message-card";
import { ReferralList } from "@/components/v2/panels/role/referral-list";
import type { ReferralRow } from "@/lib/data/referrals";

/**
 * One block: Send your link to someone (the step-by-step send) with People
 * you sent it to as a drop-down inside it. The affiliate's home and every
 * technician's and up's links page use the same block. Anything else that
 * belongs with the link (their plain link, bookings that came another way)
 * goes in under the people or at the foot of the block.
 */
export function SendLinkBlock({
  people,
  title = "Send your link to someone",
  children,
  footer,
  sample,
  open,
}: {
  people: ReferralRow[];
  title?: string;
  /** More under the people, inside the drop-down. */
  children?: React.ReactNode;
  /** Under the drop-down, still inside the block. */
  footer?: React.ReactNode;
  /** For the review pages: which screen of the send to show, and whether the people list starts open. */
  sample?: React.ComponentProps<typeof ReferralMessageCard>["sample"];
  open?: boolean;
}) {
  return (
    <section data-tour="affiliate-link" aria-labelledby="send-link" className="rounded-2xl border bg-card p-4 text-sm">
      <h2 id="send-link" className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <ReferralMessageCard sample={sample} />
      <details data-tour="affiliate-results" open={open} className="group mt-3 border-t pt-3">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
          <span className="font-semibold">People you sent it to</span>
          <span className="flex items-center gap-1 font-semibold text-primary">
            {people.length}
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden />
          </span>
        </summary>
        <div className="mt-3">
          {people.length > 0 ? (
            <ReferralList rows={people} titled={false} />
          ) : (
            <p className="text-muted-foreground">Nobody yet. Everyone you send your link to shows up here, with how far they got.</p>
          )}
          {children}
        </div>
      </details>
      {footer}
    </section>
  );
}
