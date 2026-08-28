"use client";

import { useState, useTransition } from "react";
import { Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { importContacts, previewContactImport, type ImportPreview } from "@/lib/actions/contact-import-actions";
import { modeBlurb, modeLabel, type MergeMode } from "@/lib/contact-merge";
import { CONTACT_TYPES, type ContactType } from "@/lib/contact-types";

/**
 * Bringing a CRM's contacts in.
 *
 * The type is picked here rather than guessed from the rows, because a line
 * saying "Bob's Tree Service" is obviously a subcontractor to a person and
 * indistinguishable from a client to a parser. Filter by tag in the CRM,
 * export that group, say what it is: more accurate than any heuristic and
 * about ten seconds of work.
 *
 * Nothing is written until the preview has been seen. An import is the kind of
 * thing somebody runs once with three thousand rows and then spends an
 * afternoon undoing, and one extra tap catches a mis-read column before it
 * becomes three thousand mistakes.
 */
export function ContactImportPanel() {
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [contactType, setContactType] = useState<ContactType>("client");
  const [batch, setBatch] = useState("");
  const [mode, setMode] = useState<MergeMode>("fill");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function reset() {
    setCsv("");
    setPreview(null);
    setDone(null);
    setError(null);
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!batch) setBatch(file.name.replace(/\.csv$/i, ""));
    setCsv(await file.text());
    setPreview(null);
  }

  function check() {
    setError(null);
    setDone(null);
    startTransition(async () => {
      const result = await previewContactImport(csv, mode);
      if (result.ok) setPreview(result);
      else setError(result.message);
    });
  }

  function commit() {
    setError(null);
    startTransition(async () => {
      const result = await importContacts(csv, contactType, batch, mode);
      if (result.ok) {
        setDone(result.message);
        setCsv("");
        setPreview(null);
      } else {
        setError(result.message);
      }
    });
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Upload className="h-3.5 w-3.5" />
        Import contacts
      </Button>
    );
  }

  return (
    <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <h2 className="text-sm font-semibold">Import contacts</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Export one group at a time from your CRM — filter by tag or smart list — and say what kind of
        contacts they are. Everything except clients and leads stays out of client pickers.
      </p>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">What kind of contacts are in this file</Label>
          <Select value={contactType} onValueChange={(v) => setContactType(v as ContactType)}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONTACT_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            {CONTACT_TYPES.find((t) => t.value === contactType)?.blurb}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Name this batch</Label>
          <Input
            value={batch}
            onChange={(e) => setBatch(e.target.value)}
            placeholder="GHL clients, August"
            className="h-9 text-sm"
          />
        </div>

        <Input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => void handleFile(e.target.files?.[0])}
          className="h-9 text-sm"
        />
        <Textarea
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            setPreview(null);
          }}
          placeholder="…or paste the CSV here"
          className="h-20 text-xs"
        />

        {/* The choice that decides whether a re-import is any use. Filling
            blanks cannot correct a wrong address, because the field was not
            blank, it was wrong. */}
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium">What should happen to contacts already here?</p>
          {(["fill", "overwrite"] as MergeMode[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setMode(option);
                setPreview(null);
              }}
              className={`rounded-lg border p-2.5 text-left ${
                mode === option ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <span className="block text-xs font-semibold">{modeLabel(option)}</span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {modeBlurb(option)}
              </span>
            </button>
          ))}
        </div>

        {preview && (
          <div className="rounded-lg border border-border bg-background/60 p-3 text-sm">
            <p className="font-semibold">
              {preview.creating} new · {preview.updating} to {mode === "overwrite" ? "update" : "fill in"}
              {preview.unchanged > 0 && ` · ${preview.unchanged} already complete`}
              {preview.skipped.length > 0 && ` · ${preview.skipped.length} skipped`}
            </p>

            {/* The line somebody re-importing is looking for. A run that was
                meant to add addresses and would add none should say so here,
                not after three thousand rows have gone through. */}
            {preview.gainingAddress > 0 ? (
              <p className="mt-0.5 text-xs font-medium text-emerald-700">
                {preview.gainingAddress} will gain an address.
              </p>
            ) : (
              preview.updating === 0 &&
              preview.creating === 0 && (
                <p className="mt-0.5 text-xs font-medium text-amber-800">
                  Nothing in this file is missing from what&apos;s already here — this import would change
                  nothing.
                </p>
              )
            )}
            {/* Real replacements, with both values. A mis-mapped column is
                obvious here and invisible in a count, and this is the one
                place somebody can catch it before it is three thousand
                overwritten addresses. */}
            {preview.correcting > 0 && (
              <div className="mt-1.5 rounded-md border border-amber-300/70 bg-amber-50/70 p-2">
                <p className="text-xs font-semibold text-amber-900">
                  {preview.correcting} contact{preview.correcting === 1 ? "" : "s"} will have
                  something replaced
                </p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {preview.corrections.map((c, i) => (
                    <li key={i} className="text-[11px] text-amber-900">
                      <span className="font-medium">{c.name}</span> {c.label.toLowerCase()}:{" "}
                      <span className="line-through opacity-70">{c.from}</span> → {c.to}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {preview.optedOut > 0 && (
              <p className="mt-0.5 text-xs font-medium text-amber-800">
                {preview.optedOut} marked do-not-contact — that flag comes across with them.
              </p>
            )}

            {/* The parser's own reading of the first few rows. A mis-mapped
                column is obvious here and invisible in a count. */}
            <ul className="mt-2 flex flex-col gap-1">
              {preview.sample.map((row, i) => (
                <li key={i} className="truncate text-xs text-muted-foreground">
                  {row.existing ? "↻" : "+"} {row.name}
                  {row.email && ` · ${row.email}`}
                  {row.phone && ` · ${row.phone}`}
                </li>
              ))}
            </ul>

            {preview.unmatchedHeaders.length > 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Columns nothing was done with: {preview.unmatchedHeaders.join(", ")}
              </p>
            )}
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
        {done && <p className="text-xs font-medium text-emerald-700">{done}</p>}

        <div className="flex flex-wrap gap-2">
          {!preview ? (
            <Button type="button" size="sm" onClick={check} disabled={isPending || !csv.trim()}>
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Check the file
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={commit} disabled={isPending}>
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Import {preview.creating + preview.updating} contacts
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              reset();
              setOpen(false);
            }}
            disabled={isPending}
          >
            Close
          </Button>
        </div>
      </div>
    </section>
  );
}
