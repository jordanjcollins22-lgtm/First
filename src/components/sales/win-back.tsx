"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, Copy, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { makePhaseOne } from "@/lib/actions/win-back-actions";
import { winBackText, type WinBackRow } from "@/lib/win-back";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }) : "");

/**
 * Every proposal a client said no to, biggest first, each with a way back:
 * tick the areas that matter most, type the Phase 1 price, and it goes to the
 * price approvals to be previewed and sent like any proposal.
 */
export function WinBack({ rows, sender }: { rows: WinBackRow[]; sender: string }) {
  const total = rows.reduce((sum, r) => sum + r.owed, 0);
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-bold">Win back</h2>
        <p className="text-sm text-muted-foreground">
          {rows.length === 0
            ? "No declined proposals to win back right now."
            : `${rows.length} declined, ${money(total)} in all. Nothing over $10,000 has sold yet, so offer the most important part first and keep the rest for spring.`}
        </p>
      </div>
      {rows.map((r) => (
        <WinBackCard key={r.jobId} row={r} sender={sender} />
      ))}
    </section>
  );
}

function WinBackCard({ row, sender }: { row: WinBackRow; sender: string }) {
  const [open, setOpen] = useState(false);
  const [keep, setKeep] = useState<string[]>([]);
  const [price, setPrice] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const first = row.client.split(/\s+/)[0] ?? row.client;
  const text = winBackText({ first, sender, price: Number(price) > 0 ? Number(price) : null });

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // The words are on screen to copy by hand.
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-baseline justify-between gap-2">
        <Link href={`/jobs/${row.jobId}`} className="min-w-0 truncate font-semibold hover:underline">
          {row.client}
        </Link>
        <span className="shrink-0 font-bold tabular-nums">{money(row.owed)}</span>
      </div>
      <p className="truncate text-xs text-muted-foreground">
        {row.address ?? ""}
        {row.declinedAt ? ` · declined ${day(row.declinedAt)}` : ""}
      </p>
      {row.note && <p className="mt-1 text-sm italic">“{row.note}”</p>}

      {result?.ok ? (
        <p className="mt-2 text-sm font-medium text-emerald-700">{result.message}</p>
      ) : !open ? (
        <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setOpen(true)}>
          Make a Phase 1
        </Button>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <div>
            <p className="text-xs font-semibold">Areas for Phase 1</p>
            <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
              {row.areas.map((a) => {
                const on = keep.includes(a.zoneName);
                return (
                  <label key={a.zoneName} className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => setKeep(on ? keep.filter((k) => k !== a.zoneName) : [...keep, a.zoneName])}
                    />
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{a.zoneName}</span> · {a.serviceLabel}
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">The rest is written on the job as Phase 2, for later.</p>
          </div>
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Phase 1 price
            <Input inputMode="decimal" placeholder="e.g. 4500" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} className="max-w-40" />
          </label>
          <div className="rounded-lg bg-muted/50 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold">Text it first, from your phone</p>
              <button type="button" onClick={copy} className="flex items-center gap-1 text-xs font-medium text-primary">
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="mt-1 text-sm">{text}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setResult(await makePhaseOne({ jobId: row.jobId, keep, price: Number(price) }));
                })
              }
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Phase 1 for approval"}
            </Button>
            <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
          {result && !result.ok && <p className="text-sm text-destructive">{result.message}</p>}
        </div>
      )}
    </div>
  );
}
