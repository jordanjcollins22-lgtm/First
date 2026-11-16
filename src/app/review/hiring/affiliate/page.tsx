import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { reviewPagesEnabled } from "@/lib/review-pages";
import { AFFILIATE_PREVIEW_PAGES } from "@/lib/hiring/affiliate-preview";

/**
 * Every page built for hiring an affiliate, from writing the job down to
 * fully operating, in Alex's order, on one list with no sign-in.
 */
export const dynamic = "force-dynamic";

export default function AffiliatePreviewIndex() {
  if (!reviewPagesEnabled()) notFound();
  return (
    <main className="mx-auto w-full max-w-2xl space-y-5 px-4 py-6">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Preview · sample data</p>
        <h1 className="text-2xl font-bold">Affiliate: hiring to fully operating</h1>
        <p className="text-sm text-muted-foreground">
          Every page built for the affiliate job, in the order of the hiring structure. Tap one to open it. The people on them are made up, and buttons are switched off so nothing saves.
        </p>
      </header>
      <ol className="space-y-3">
        {AFFILIATE_PREVIEW_PAGES.map((p, i) => (
          <li key={p.key}>
            <Link href={`/review/hiring/affiliate/${p.key}`} className="block rounded-2xl border border-border bg-card p-4 hover:border-primary">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold">
                  {i + 1}. {p.title}
                </p>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{p.what}</p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {p.steps.map((s) => (
                  <li key={s.id} className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    {s.id} {s.name}
                  </li>
                ))}
              </ul>
            </Link>
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">
        Not in this preview: step 10 Compliance (the paperwork checklist, an existing page), and the in-app tutorial on Posts to Answer (step 16), which needs the affiliate signed in.
      </p>
    </main>
  );
}
