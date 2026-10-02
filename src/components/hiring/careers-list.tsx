import Image from "next/image";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { POSITIONS } from "@/lib/hiring/positions";
import { careersHref } from "@/lib/hiring/links";

/** Every open job. Kept apart from the loading so it can be previewed. */
export function CareersList({ orgName, keep }: { orgName: string; keep: { org: string | null; src: string | null } }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-5 px-4 py-6">
      <header className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#2f6d3c]">
          <Image src="/logo-mark.png" alt="" width={28} height={28} className="h-7 w-7" priority />
        </span>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{orgName}</p>
          <h1 className="text-xl font-bold">Join our team</h1>
        </div>
      </header>
      <p className="text-sm text-muted-foreground">
        Pick the job you want. Applying takes about 3 minutes. If you&apos;re a fit, we&apos;ll ask for a short video from your
        phone, then meet you in person.
      </p>
      <ul className="flex flex-col gap-3">
        {POSITIONS.map((p) => (
          <li key={p.key}>
            <Link
              href={careersHref(`/careers/${p.key}`, keep)}
              className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm hover:border-primary/40"
            >
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{p.title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{p.tagline}</p>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
