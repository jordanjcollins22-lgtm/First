"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Eye, EyeOff, Loader2, Pencil, Star, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { deleteProof, moveProof, saveNews, saveReview, setProofShown } from "@/lib/actions/booking-proof-actions";
import type { ProofRow } from "@/lib/data/booking-proof";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Where the owner enters what the landing card shows: the news story and the
 * reviews, word for word as they were written. Each can be hidden without
 * deleting it, and put in order.
 */
export function ProofEditor({ rows }: { rows: ProofRow[] }) {
  const news = rows.filter((r) => r.kind === "news");
  const reviews = rows.filter((r) => r.kind === "review");
  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">The news story</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Backs up &ldquo;featured in the news&rdquo;. The first one shown goes on the landing card.
        </p>
        <ul className="mb-3 flex flex-col gap-2">
          {news.map((r, i) => (
            <ProofItem key={r.id} row={r} first={i === 0} last={i === news.length - 1} />
          ))}
        </ul>
        <NewsForm />
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Reviews ({reviews.length})</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Backs up &ldquo;amazing reviews&rdquo;. Pulled ones arrive here on their own; you can add one by hand too. Only
          5-star reviews show on the page. The first three show on the card, the rest behind &ldquo;See all&rdquo;.
        </p>
        <ul className="mb-3 flex flex-col gap-2">
          {reviews.map((r, i) => (
            <ProofItem key={r.id} row={r} first={i === 0} last={i === reviews.length - 1} />
          ))}
        </ul>
        <ReviewForm />
      </section>
    </div>
  );
}

function useAct() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  function act(run: () => Promise<Result>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await run();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      after?.();
      router.refresh();
    });
  }
  return { act, pending, error };
}

function ProofItem({ row, first, last }: { row: ProofRow; first: boolean; last: boolean }) {
  const { act, pending, error } = useAct();
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="rounded-xl border border-primary/40 p-3">
        {row.kind === "review" ? <ReviewForm row={row} onDone={() => setEditing(false)} /> : <NewsForm row={row} onDone={() => setEditing(false)} />}
      </li>
    );
  }

  return (
    <li className={`rounded-xl border border-border p-3 text-sm ${row.shown ? "" : "opacity-60"}`}>
      {row.kind === "review" ? (
        <>
          {row.stars != null && (
            <span className="mb-1 flex gap-0.5">
              {Array.from({ length: 5 }, (_, i) => (
                <Star key={i} className={`h-3 w-3 ${i < row.stars! ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`} />
              ))}
            </span>
          )}
          <p className="line-clamp-3">&ldquo;{row.body}&rdquo;</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {row.author}
            {row.source ? `, ${row.source}` : ""}
          </p>
        </>
      ) : (
        <>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{row.outlet}</p>
          <p>{row.headline}</p>
          {row.url && (
            <a href={row.url} target="_blank" rel="noreferrer" className="text-xs text-primary underline">
              Open the story
            </a>
          )}
        </>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(true)}>
          <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => act(() => setProofShown(row.id, !row.shown))}>
          {row.shown ? <EyeOff className="mr-1 h-3.5 w-3.5" /> : <Eye className="mr-1 h-3.5 w-3.5" />}
          {row.shown ? "Hide" : "Show"}
        </Button>
        <Button type="button" size="icon" variant="ghost" className="h-8 w-8" disabled={pending || first} onClick={() => act(() => moveProof(row.id, -1))} aria-label="Move up">
          <ArrowUp className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" size="icon" variant="ghost" className="h-8 w-8" disabled={pending || last} onClick={() => act(() => moveProof(row.id, 1))} aria-label="Move down">
          <ArrowDown className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-destructive"
          disabled={pending}
          onClick={() => {
            if (window.confirm("Delete this for good?")) act(() => deleteProof(row.id));
          }}
        >
          <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
        </Button>
        {!row.shown && <span className="text-xs text-muted-foreground">Hidden from the page</span>}
        {row.kind === "review" && row.shown && row.stars != null && row.stars < 5 && (
          <span className="text-xs text-amber-700">Not on the page: only 5-star reviews show</span>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </li>
  );
}

const SOURCES = ["Google", "Facebook", "Nextdoor", "Yelp", "Angi", "Thumbtack"];

function ReviewForm({ row, onDone }: { row?: ProofRow; onDone?: () => void }) {
  const { act, pending, error } = useAct();
  const [author, setAuthor] = useState(row?.author ?? "");
  const [body, setBody] = useState(row?.body ?? "");
  const [stars, setStars] = useState<number | null>(row ? row.stars : 5);
  const [source, setSource] = useState(row?.source ?? "Google");

  function save() {
    act(
      () => saveReview({ id: row?.id ?? null, author, body, stars, source, writtenOn: row?.writtenOn ?? null }),
      () => {
        if (row) onDone?.();
        else {
          setAuthor("");
          setBody("");
          setStars(5);
        }
      }
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {!row && <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Add a review</p>}
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="What they wrote, word for word" />
      <div className="grid grid-cols-2 gap-2">
        <Input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Their name, e.g. Jill M." />
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          aria-label="Where it was posted"
        >
          {SOURCES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-1">
        <span className="mr-1 text-xs text-muted-foreground">Stars</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => setStars(stars === n ? null : n)} aria-label={`${n} stars`}>
            <Star className={`h-5 w-5 ${stars != null && n <= stars ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"}`} />
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={save}>
          {pending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          {row ? "Save" : "Add review"}
        </Button>
        {row && (
          <Button type="button" size="sm" variant="outline" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function NewsForm({ row, onDone }: { row?: ProofRow; onDone?: () => void }) {
  const { act, pending, error } = useAct();
  const [outlet, setOutlet] = useState(row?.outlet ?? "");
  const [headline, setHeadline] = useState(row?.headline ?? "");
  const [url, setUrl] = useState(row?.url ?? "");

  function save() {
    act(
      () => saveNews({ id: row?.id ?? null, outlet, headline, url }),
      () => {
        if (row) onDone?.();
        else {
          setOutlet("");
          setHeadline("");
          setUrl("");
        }
      }
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {!row && <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Add a news story</p>}
      <Input value={outlet} onChange={(e) => setOutlet(e.target.value)} placeholder="Outlet, e.g. WBAL-TV 11" />
      <Input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="The headline" />
      <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Link to the story or video" inputMode="url" />
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={save}>
          {pending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          {row ? "Save" : "Add story"}
        </Button>
        {row && (
          <Button type="button" size="sm" variant="outline" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
