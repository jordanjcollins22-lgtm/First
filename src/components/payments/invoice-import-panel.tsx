"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Upload } from "lucide-react";

import {
  importInvoices,
  previewInvoiceCsv,
  type ImportInvoicesResult,
} from "@/lib/actions/invoice-import-actions";

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/**
 * Bringing an invoice export in.
 *
 * Previewed before it runs, always. The two things that go wrong with a file
 * like this are both visible in a preview and invisible afterwards: a column
 * read as the wrong thing, and clients who are not in the book yet.
 */
export function InvoiceImportPanel() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [preview, setPreview] = useState<ImportInvoicesResult | null>(null);
  const [done, setDone] = useState<ImportInvoicesResult | null>(null);
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
      const result = await previewInvoiceCsv(csv);
      if (result.ok) setPreview(result);
      else setError(result.message);
    });
  }

  function run() {
    setError(null);
    start(async () => {
      const result = await importInvoices(csv, sourceName);
      if (result.ok) {
        setDone(result);
        setPreview(null);
        setCsv("");
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      } else {
        setError(result.message);
        if (result.unmatched?.length) setDone(result);
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-card/60 px-3 py-2.5 text-sm font-semibold"
      >
        <Upload className="h-4 w-4" /> Import invoices from a file
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Upload className="h-4 w-4" /> Import invoices
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs font-semibold text-muted-foreground underline-offset-2 hover:underline"
        >
          Close
        </button>
      </div>

      <p className="mb-2 text-xs text-muted-foreground">
        An invoice list exported as CSV. Contacts have to be in the book already — an invoice for
        somebody who is not gets named rather than making a contact up.
      </p>

      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => read(e.target.files?.[0] ?? null)}
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm file:mr-2 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs file:font-semibold"
      />

      {csv && !preview && !done && (
        <button
          type="button"
          disabled={pending}
          onClick={look}
          className="mt-2 w-full rounded-md border border-border px-3 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {pending ? "Reading…" : "See what's in it"}
        </button>
      )}

      {preview?.preview && (
        <div className="mt-2 space-y-2 rounded-md border border-border bg-background p-2">
          <p className="text-xs font-semibold">{preview.message}</p>
          <dl className="grid grid-cols-2 gap-1 text-[11px]">
            <Stat label="Invoices" value={String(preview.preview.count)} />
            <Stat label="Billed" value={money(preview.preview.totalCents)} />
            <Stat label="Already paid" value={String(preview.preview.paid)} />
            <Stat label="Still owed" value={String(preview.preview.outstanding)} />
          </dl>
          {preview.preview.noContact > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {preview.preview.noContact} have nobody named on them and will be left out.
            </p>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={run}
            className="w-full rounded-md bg-foreground px-3 py-2 text-sm font-semibold text-background disabled:opacity-50"
          >
            {pending ? "Importing…" : "Bring them in"}
          </button>
          <p className="text-[11px] text-muted-foreground">
            Safe to run twice. Invoices update on their number rather than doubling up.
          </p>
        </div>
      )}

      {error && (
        <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-destructive">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}

      {done && (
        <div className="mt-2 space-y-1">
          {done.ok && (
            <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5" /> {done.message}
            </p>
          )}
          {done.unmatched && done.unmatched.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Nobody in the book for: {done.unmatched.join(", ")}. Add them and run it again — the
              invoices already in will update rather than double.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border px-1.5 py-1">
      <dt className="uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-bold">{value}</dd>
    </div>
  );
}
