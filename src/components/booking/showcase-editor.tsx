"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { setShowcaseShown } from "@/lib/actions/booking-proof-actions";
import type { ShowcaseRow } from "@/lib/data/booking-proof";

/**
 * Which before-and-afters cycle on the landing card: the posts approved and
 * formatted in Before & After Posts from job photos, and nothing else. Every
 * one approved comes in on its own; any of them can be kept off this page.
 */
export function ShowcaseEditor({ rows }: { rows: ShowcaseRow[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const shown = rows.filter((r) => r.shown).length;

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">
        Before and afters ({shown} showing)
        {pending && <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin" />}
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Cycle under &ldquo;See open times&rdquo;. Only the ones approved and formatted in{" "}
        <Link href="/admin/social" className="underline">
          Before &amp; After Posts
        </Link>{" "}
        from job photos; each one you approve comes in on its own.
      </p>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {rows.map((r) => (
          <li key={r.id} className={`overflow-hidden rounded-xl border border-border ${r.shown ? "" : "opacity-50"}`}>
            <div className="relative aspect-[4/3] bg-muted">
              <Image src={r.imageUrl} alt={r.title} fill sizes="240px" className="object-contain" />
            </div>
            <div className="p-2">
              <p className="truncate text-xs font-medium">{r.title}</p>
              <div className="mt-1 flex gap-1">
                <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={pending} onClick={() => run(() => setShowcaseShown(r.id, !r.shown))}>
                  {r.shown ? <EyeOff className="mr-1 h-3 w-3" /> : <Eye className="mr-1 h-3 w-3" />}
                  {r.shown ? "Hide" : "Show"}
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {rows.length === 0 && <p className="text-sm text-muted-foreground">None approved yet. Approve one in Before &amp; After Posts and it shows here and on the booking page.</p>}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </section>
  );
}
