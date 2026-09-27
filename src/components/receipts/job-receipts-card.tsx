"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Receipt } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { addJobReceipt } from "@/lib/actions/job-receipt-actions";
import { parseDollars, receiptsTotal, sayDollars } from "@/lib/job-receipts";
import type { JobReceipt } from "@/lib/data/job-receipts";

/**
 * Something bought for the job. Materials are ordered ahead, so this is
 * the exception: add a photo or a screenshot of the receipt and say what it
 * was for. The office sees the same list on the job.
 */
export function JobReceiptsCard({
  jobId,
  receipts,
  canAdd = true,
  preview = false,
  startOpen = false,
  onDemoAdd,
}: {
  jobId: string;
  receipts: JobReceipt[];
  /** The office reads the list; the crew add to it. */
  canAdd?: boolean;
  /** For the walk-through: nothing is uploaded or saved. */
  preview?: boolean;
  startOpen?: boolean;
  /** For a demo: the receipt is added on this screen only, nothing uploaded or saved. */
  onDemoAdd?: (receipt: JobReceipt) => void;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(startOpen);
  const [file, setFile] = useState<File | null>(null);
  const [what, setWhat] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const total = receiptsTotal(receipts);

  function save() {
    setError(null);
    if (preview) return;
    if (!file) return setError("Add the photo or screenshot of the receipt.");
    if (!what.trim()) return setError("Say what you bought.");
    if (onDemoAdd) {
      const cents = amount.trim() ? parseDollars(amount) : null;
      if (amount.trim() && cents == null) return setError("The amount should look like 12.50.");
      onDemoAdd({ id: crypto.randomUUID(), what: what.trim(), amountCents: cents, url: URL.createObjectURL(file), byName: "You", at: new Date().toISOString() });
      setFile(null);
      setWhat("");
      setAmount("");
      setOpen(false);
      return;
    }
    start(async () => {
      const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${jobId}/receipt-${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await createClient().storage.from("job-photos").upload(path, file, { contentType: file.type || undefined });
      if (uploadError) return setError("Couldn't upload the receipt. Check your signal and try again.");
      const result = await addJobReceipt(jobId, path, what, amount);
      if (!result.ok) return setError(result.message);
      setFile(null);
      setWhat("");
      setAmount("");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card/80 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Receipt className="h-4 w-4 text-primary" /> Receipts
          </h2>
          <p className="text-xs text-muted-foreground">Materials are ordered ahead. Had to buy something? Add the receipt here.</p>
        </div>
        {receipts.length > 0 && total > 0 && <p className="shrink-0 text-sm font-semibold">{sayDollars(total)}</p>}
      </div>

      {receipts.length > 0 && (
        <ul className="flex flex-col gap-2">
          {receipts.map((r) => (
            <li key={r.id} className="flex items-center gap-2.5 text-sm">
              {r.url ? (
                <a href={r.url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.url} alt={`Receipt: ${r.what}`} className="h-12 w-12 rounded-md border border-border object-cover" />
                </a>
              ) : (
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-muted">
                  <Receipt className="h-4 w-4 text-muted-foreground" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.what}</span>
                <span className="block text-xs text-muted-foreground">
                  {[r.byName, new Date(r.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })].filter(Boolean).join(" · ")}
                </span>
              </span>
              {r.amountCents != null && <span className="shrink-0 font-medium">{sayDollars(r.amountCents)}</span>}
            </li>
          ))}
        </ul>
      )}

      {canAdd && !open && (
        <Button type="button" variant="outline" className="h-11" onClick={() => setOpen(true)}>
          <Receipt className="mr-1.5 h-4 w-4" /> Add a receipt
        </Button>
      )}

      {canAdd && open && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-background/70 p-2.5">
          {/* No camera capture: a screenshot from the store's app is as good as a photo of the paper. */}
          <input ref={input} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <Button type="button" variant="outline" className="h-11" onClick={() => (preview ? undefined : input.current?.click())}>
            {file ? `Receipt: ${file.name}` : "Choose the photo or screenshot"}
          </Button>
          <Input value={what} onChange={(e) => setWhat(e.target.value)} placeholder="What did you buy, and why? e.g. 2 bags of mulch, ran short" className="h-11" />
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Amount, e.g. 18.50 (optional)" className="h-11" />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex items-center gap-3">
            <Button type="button" className="h-11 flex-1 font-semibold" disabled={pending} onClick={save}>
              {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Save the receipt
            </Button>
            <button type="button" className="text-sm text-muted-foreground" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
