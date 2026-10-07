import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import type { Position } from "@/lib/hiring/positions";
import { publicPayLine } from "@/lib/hiring/indeed-ad";
import { careersHref } from "@/lib/hiring/links";
import { ApplyForm } from "@/components/hiring/apply-form";

/** One job and its application. Kept apart from the loading so it can be previewed. */
export function PositionView({
  position,
  orgName,
  keep,
}: {
  position: Position;
  orgName: string;
  keep: { org: string | null; src: string | null; inv?: string | null };
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-5 px-4 py-6">
      <Link href={careersHref("/careers", keep)} className="flex items-center gap-1 text-sm text-muted-foreground">
        <ChevronLeft className="h-4 w-4" /> All jobs
      </Link>
      <header>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{orgName}</p>
        <h1 className="text-2xl font-bold leading-tight">{position.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{position.tagline}</p>
      </header>

      <section className="space-y-3 rounded-2xl border border-border bg-card p-4 text-sm">
        <div>
          <h2 className="font-semibold">What you&apos;ll do</h2>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {position.duties.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="font-semibold">What we&apos;re looking for</h2>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {position.lookingFor.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
        {publicPayLine(position) && (
          <div>
            <h2 className="font-semibold">Pay</h2>
            <p>{publicPayLine(position)}</p>
          </div>
        )}
        <div>
          <h2 className="font-semibold">Schedule</h2>
          <p>{position.schedule}</p>
        </div>
      </section>

      <ApplyForm position={position} org={keep.org} source={keep.src} invite={keep.inv ?? null} businessName={orgName} />
    </main>
  );
}
