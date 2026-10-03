import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { isSupabaseConfigured } from "@/lib/env";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { PriceCard } from "@/components/proposal/price-approvals";
import { getPriceApprovals } from "@/lib/data/price-approvals";

/**
 * One walkthrough's price, service by service with the photos, to accept
 * and send. Price it on an evaluation opens this.
 */
export const dynamic = "force-dynamic";

export default async function PricePage({ params }: { params: Promise<{ jobId: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const { jobId } = await params;
  const items = await getPriceApprovals({ jobId });
  const item = items?.[0] ?? null;
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6">
      <Link href="/sales?tab=today" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ChevronLeft className="h-4 w-4" /> To price and send
      </Link>
      {items === null ? (
        <p className="rounded-xl border border-border p-4 text-sm text-muted-foreground">Only an owner, admin or account manager can price a proposal.</p>
      ) : item ? (
        <PriceCard item={item} />
      ) : (
        <p className="rounded-xl border border-border p-4 text-sm">
          There&apos;s nothing to price here: this proposal has been sent, or the walkthrough hasn&apos;t been submitted yet.{" "}
          <Link href={`/jobs/${jobId}?open=proposal`} className="font-medium text-primary underline">
            Open the job
          </Link>
        </p>
      )}
    </div>
  );
}
