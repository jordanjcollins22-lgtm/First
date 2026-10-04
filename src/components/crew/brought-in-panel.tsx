"use client";

import { useState, useTransition } from "react";
import { Check, ChevronDown, Copy, Loader2, Plus, Share2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { addBroughtInLead } from "@/lib/actions/brought-in-actions";
import { upcoming, type BroughtInRow } from "@/lib/brought-in";
import { cn } from "@/lib/utils";

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

/** The fastest ways to bring a project in, in the order they pay off. */
const HOW = [
  "Ask the client you're working for about one more thing you can see: other beds, mulch, edging, shrubs, gutters. Tap Add a lead, then More work.",
  "Knock on the two houses next door and the three across the street while the crew works: \"We're doing the yard right there. Want a free look at yours while we're here?\" Tap Add a lead, then A neighbor.",
  "At the final walkthrough, when they're happiest, ask who they know who'd want this, and give them your link.",
  "Text your link and a before-and-after photo to 10 people you know.",
  "Answer \"anyone know a landscaper?\" posts in local Facebook groups and Nextdoor with your link.",
];

/**
 * The projects this person brought in, and the two ways to bring in more:
 * their own link, and a lead typed in on the spot. Whatever sells pays them
 * 4%, and the list says what each one is worth to them.
 */
export function BroughtInPanel({
  rows,
  link,
  qrSvg,
  stops,
}: {
  rows: BroughtInRow[];
  link: string | null;
  qrSvg: string | null;
  /** Today's jobs, for adding more work for the client in front of them. */
  stops: { jobId: string; name: string }[];
}) {
  const [adding, setAdding] = useState(false);
  const [showHow, setShowHow] = useState(rows.length === 0);
  const [copied, setCopied] = useState(false);
  const open = upcoming(rows);
  const worth = open.reduce((sum, r) => sum + (r.yours ?? 0), 0);

  async function share() {
    if (!link) return;
    try {
      if (navigator.share) await navigator.share({ title: "JS Landscaping", text: "Book a free yard evaluation with my crew:", url: link });
      else {
        await navigator.clipboard.writeText(link);
        setCopied(true);
      }
    } catch {
      // Backing out of the share sheet is not an error.
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your projects</p>
          <p className="text-lg font-bold">
            {open.length === 0 ? "No upcoming projects you brought in yet" : `${open.length} upcoming you brought in`}
          </p>
          <p className="text-xs text-muted-foreground">
            You earn 4% of every project you bring in that sells{worth > 0 ? `. These are worth ${money(worth)} to you if they sell` : ""}.
          </p>
        </div>
        <Sparkles className="h-6 w-6 shrink-0 text-primary" />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button type="button" className="h-11" onClick={() => setAdding((a) => !a)}>
          <Plus className="mr-1 h-4 w-4" /> Add a lead
        </Button>
        <Button type="button" variant="outline" className="h-11" onClick={share} disabled={!link}>
          {copied ? <Check className="mr-1 h-4 w-4" /> : <Share2 className="mr-1 h-4 w-4" />} {copied ? "Link copied" : "Share my link"}
        </Button>
      </div>

      {adding && <AddLead stops={stops} onDone={() => setAdding(false)} />}

      {link && qrSvg && (
        <details className="mt-3 rounded-xl border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">Show my QR code</summary>
          <p className="mt-1 text-xs text-muted-foreground">Let them scan it from your phone. Anything they book is yours.</p>
          <span className="mx-auto mt-2 block w-48 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                setCopied(true);
              } catch {
                // Clipboard refused: the link is shown below to copy by hand.
              }
            }}
            className="mt-2 flex w-full items-center justify-center gap-1 break-all text-xs text-primary underline"
          >
            <Copy className="h-3 w-3 shrink-0" /> {link}
          </button>
        </details>
      )}

      {rows.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {rows.map((r) => (
            <li
              key={r.jobId}
              className={cn(
                "rounded-xl border p-3 text-sm",
                r.step === "sold" || r.step === "done" ? "border-emerald-400 bg-emerald-50/50" : r.step === "lost" ? "border-border opacity-60" : "border-border"
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">{r.client}</span>
                {r.yours != null && <span className="shrink-0 text-xs font-semibold tabular-nums text-emerald-700">Your 4%: {money(r.yours)}</span>}
              </div>
              <p className="truncate text-xs text-muted-foreground">{r.address}</p>
              <p className="mt-1 text-xs">{r.label}</p>
            </li>
          ))}
        </ul>
      )}

      <button type="button" onClick={() => setShowHow((s) => !s)} className="mt-3 flex w-full items-center justify-between text-sm font-semibold">
        How to bring in projects, fastest first
        <ChevronDown className={cn("h-4 w-4 transition-transform", showHow && "rotate-180")} />
      </button>
      {showHow && (
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
          {HOW.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ol>
      )}
    </section>
  );
}

function AddLead({ stops, onDone }: { stops: { jobId: string; name: string }[]; onDone: () => void }) {
  const [kind, setKind] = useState<"neighbor" | "more_work">("neighbor");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [jobId, setJobId] = useState(stops[0]?.jobId ?? "");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function save() {
    setResult(null);
    start(async () => {
      const r = await addBroughtInLead({ kind, name, phone, address, note, jobId: kind === "more_work" ? jobId : null });
      setResult(r);
      if (r.ok) {
        setName("");
        setPhone("");
        setAddress("");
        setNote("");
        setTimeout(onDone, 1500);
      }
    });
  }

  const field = "h-11 w-full rounded-lg border border-border bg-background px-3 text-sm";
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-xl border border-primary/40 bg-primary/5 p-3">
      <div className="grid grid-cols-2 gap-2">
        {(["neighbor", "more_work"] as const).map((k) => (
          <button
            key={k}
            type="button"
            disabled={k === "more_work" && stops.length === 0}
            onClick={() => setKind(k)}
            className={cn("h-10 rounded-lg border-2 text-sm font-medium disabled:opacity-40", kind === k ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background")}
          >
            {k === "neighbor" ? "A neighbor" : "More work, this client"}
          </button>
        ))}
      </div>
      {kind === "neighbor" ? (
        <>
          <input className={field} placeholder="Their name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={field} placeholder="Phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <input className={field} placeholder="Address" value={address} onChange={(e) => setAddress(e.target.value)} />
        </>
      ) : (
        <select className={field} value={jobId} onChange={(e) => setJobId(e.target.value)}>
          {stops.map((s) => (
            <option key={s.jobId} value={s.jobId}>
              {s.name}
            </option>
          ))}
        </select>
      )}
      <textarea
        className="min-h-20 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        placeholder={kind === "neighbor" ? "What they want done (beds, mulch, lawn...)" : "What extra work they want"}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <Button type="button" className="h-11" onClick={save} disabled={pending}>
        {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />} Save the lead
      </Button>
      {result && <p className={cn("text-sm", result.ok ? "text-emerald-700" : "text-destructive")}>{result.message}</p>}
    </div>
  );
}
