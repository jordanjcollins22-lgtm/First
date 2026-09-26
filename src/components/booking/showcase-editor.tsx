"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, ImagePlus, Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addShowcase, deleteShowcase, setShowcaseShown } from "@/lib/actions/booking-proof-actions";
import { shrinkImage } from "@/lib/shrink-image";
import type { ShowcaseRow } from "@/lib/data/booking-proof";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Which before-and-afters cycle on the landing card: every post approved in
 * Before & After Posts from job photos, which comes in on its own, and any
 * finished before-and-after uploaded here. Any of them can be kept off the
 * page; the uploaded ones can be deleted.
 */
export function ShowcaseEditor({ rows }: { rows: ShowcaseRow[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const shown = rows.filter((r) => r.shown).length;

  function run(action: () => Promise<Result>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error);
      else {
        after?.();
        router.refresh();
      }
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
        comes in on its own, and you can upload finished ones below.
      </p>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {rows.map((r) => (
          <li key={r.id} className={`overflow-hidden rounded-xl border border-border ${r.shown ? "" : "opacity-50"}`}>
            <div className="relative aspect-[4/5] bg-muted">
              <Image src={r.imageUrl} alt={r.title} fill sizes="160px" className="object-cover" />
            </div>
            <div className="p-1.5">
              <p className="truncate text-[11px] font-medium">{r.title}</p>
              <div className="mt-0.5 flex">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-1.5 text-[11px]"
                  disabled={pending}
                  onClick={() => run(() => setShowcaseShown(r.id, !r.shown))}
                >
                  {r.shown ? <EyeOff className="mr-1 h-3 w-3" /> : <Eye className="mr-1 h-3 w-3" />}
                  {r.shown ? "Hide" : "Show"}
                </Button>
                {r.source === "upload" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="ml-auto h-7 px-1.5 text-destructive"
                    disabled={pending}
                    aria-label={`Delete ${r.title}`}
                    onClick={() => {
                      if (window.confirm(`Delete "${r.title}" for good?`)) run(() => deleteShowcase(r.id));
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">None yet. Approve one in Before &amp; After Posts, or upload one below.</p>
      )}
      <UploadShowcase run={run} pending={pending} />
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </section>
  );
}

/** One finished before-and-after picture, shrunk on the phone before it is sent. */
function UploadShowcase({ run, pending }: { run: (action: () => Promise<Result>, after?: () => void) => void; pending: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");

  function send() {
    if (!file) return;
    run(
      async () => {
        const small = await shrinkImage(file, 1350, 0.82);
        const form = new FormData();
        form.set("file", small);
        form.set("title", title);
        return addShowcase(form);
      },
      () => {
        setFile(null);
        setTitle("");
        if (input.current) input.current.value = "";
      }
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-xl border border-dashed border-border p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Upload a finished before and after</p>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="text-xs file:mr-2 file:rounded-md file:border file:border-border file:bg-background file:px-2 file:py-1"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <div className="flex gap-2">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What the job was, e.g. Mulch & edging" />
        <Button type="button" disabled={pending || !file || !title.trim()} onClick={send}>
          <ImagePlus className="mr-1 h-4 w-4" /> Add
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">Best at 1080 by 1350, the size Before &amp; After Posts makes them.</p>
    </div>
  );
}
