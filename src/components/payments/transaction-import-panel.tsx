"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  importTransactions,
  previewTransactionImport,
  type TransactionPreviewResult,
} from "@/lib/actions/transaction-import-actions";

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/**
 * Bringing a payments export in.
 *
 * Previewed before it is run, always. A payments file is the one somebody
 * imports once and then spends an evening unpicking, and the two things that
 * go wrong are both visible in a preview: a column read as the wrong thing,
 * and payers who are not contacts here yet.
 */
export function TransactionImportPanel() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [csv, setCsv] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [preview, setPreview] = useState<TransactionPreviewResult | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function read(file: File | null) {
    setError(null);
    setPreview(null);
    setDone(null);
    if (!file) return;
    if (!sourceName) setSourceName(file.name.replace(/\.[^.]+$/, ""));
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result ?? ""));
    reader.onerror = () => setError("Couldn't read that file.");
    reader.readAsText(file);
  }

  function look() {
    setError(null);
    setDone(null);
    start(async () => {
      const result = await previewTransactionImport(csv);
      if (result.ok) setPreview(result);
      else setError(result.message);
    });
  }

  function run() {
    setError(null);
    start(async () => {
      const result = await importTransactions(csv, sourceName);
      if (result.ok) {
        setDone(result.message);
        setPreview(null);
        setCsv("");
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-white/60 bg-card/70 p-4 backdrop-blur-xl">
      <div>
        <h2 className="text-sm font-semibold">Import a payments export</h2>
        <p className="text-xs text-muted-foreground">
          A CSV from wherever the money was taken. Each row is matched to a contact, and where the
          job can be worked out it is marked paid and moves on the pipeline.
        </p>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="text-xs"
        onChange={(e) => read(e.target.files?.[0] ?? null)}
      />

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">
          What to call this batch, so a payment can be traced back to it
        </span>
        <Input
          value={sourceName}
          onChange={(e) => setSourceName(e.target.value)}
          placeholder="GHL transactions, March"
          className="h-9 text-sm"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={!csv || pending} onClick={look}>
          <Upload className="h-4 w-4" />
          {pending && !preview ? "Reading…" : "See what this would do"}
        </Button>
        {preview?.ok && (
          <Button type="button" size="sm" disabled={pending} onClick={run}>
            {pending ? "Importing…" : `Import ${preview.preview.total} rows`}
          </Button>
        )}
      </div>

      {preview?.ok && (
        <div className="flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs">
          <p className="font-semibold">
            {preview.preview.settled} settled, {money(preview.preview.settledCents)} in total.
          </p>
          {(preview.preview.refunded > 0 || preview.preview.failed > 0) && (
            <p className="text-muted-foreground">
              {preview.preview.refunded} refunded and {preview.preview.failed} failed. Both are
              recorded against the client, and neither marks a job paid.
            </p>
          )}
          {preview.preview.undated > 0 && (
            <p className="text-amber-600">
              {preview.preview.undated} have no date this could read. They go in without one rather
              than being filed under today.
            </p>
          )}

          {preview.unmatchedHeaders.length > 0 && (
            <p className="text-amber-600">
              Nothing read these columns: {preview.unmatchedHeaders.join(", ")}. Tell me if one of
              them matters.
            </p>
          )}

          {preview.unmatchedClients.length > 0 && (
            <div>
              <p className="font-medium text-amber-700">
                Not contacts here yet, so their payments would be skipped:
              </p>
              <p className="text-muted-foreground">{preview.unmatchedClients.join(", ")}</p>
            </div>
          )}

          {preview.skipped.length > 0 && (
            <p className="text-muted-foreground">
              {preview.skipped.length} rows skipped: {preview.skipped[0].reason}
            </p>
          )}

          <ul className="flex flex-col gap-0.5 text-muted-foreground">
            {preview.sample.map((row, i) => (
              <li key={i} className="truncate">
                {row.name} · {row.amount.toLocaleString("en-US", { style: "currency", currency: "USD" })}{" "}
                · {row.date ?? "no date"} · {row.status}
              </li>
            ))}
          </ul>
        </div>
      )}

      {done && <p className="text-xs font-medium text-primary">{done}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </section>
  );
}
