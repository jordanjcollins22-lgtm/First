"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { deleteShowcase, setShowcaseShown } from "@/lib/actions/booking-proof-actions";
import type { ShowcaseRow } from "@/lib/data/booking-proof";

const FROM: Record<ShowcaseRow["source"], string> = { owner: "Added here", website: "From the website", studio: "Approved in Before & After Posts" };

/**
 * Which before-and-afters cycle on the landing card. Every post approved in
 * Before & After Posts comes in on its own; any of them can be hidden.
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
        Cycle under &ldquo;See open times&rdquo;. Every one you approve in{" "}
        <Link href="/admin/social" className="underline">
          Before &amp; After Posts
        </Link>{" "}
        comes in on its own.
      </p>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {rows.map((r) => (
          <li key={r.id} className={`overflow-hidden rounded-xl border border-border ${r.shown ? "" : "opacity-50"}`}>
            <div className="relative flex aspect-[4/3] gap-px bg-muted">
              {r.beforeUrl && r.afterUrl ? (
                <>
                  <span className="relative w-1/2">
                    <Image src={r.beforeUrl} alt={`${r.title}, before`} fill sizes="120px" className="object-cover" />
                  </span>
                  <span className="relative w-1/2">
                    <Image src={r.afterUrl} alt={`${r.title}, after`} fill sizes="120px" className="object-cover" />
                  </span>
                </>
              ) : r.imageUrl ? (
                <Image src={r.imageUrl} alt={r.title} fill sizes="240px" className="object-cover" />
              ) : null}
            </div>
            <div className="p-2">
              <p className="truncate text-xs font-medium">{r.title}</p>
              <p className="truncate text-[10px] text-muted-foreground">{FROM[r.source]}</p>
              <div className="mt-1 flex gap-1">
                <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={pending} onClick={() => run(() => setShowcaseShown(r.id, !r.shown))}>
                  {r.shown ? <EyeOff className="mr-1 h-3 w-3" /> : <Eye className="mr-1 h-3 w-3" />}
                  {r.shown ? "Hide" : "Show"}
                </Button>
                {r.source !== "studio" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-destructive"
                    disabled={pending}
                    onClick={() => {
                      if (window.confirm("Delete this one for good?")) run(() => deleteShowcase(r.id));
                    }}
                    aria-label={`Delete ${r.title}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {rows.length === 0 && <p className="text-sm text-muted-foreground">None yet. Approve one in Before &amp; After Posts.</p>}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </section>
  );
}
