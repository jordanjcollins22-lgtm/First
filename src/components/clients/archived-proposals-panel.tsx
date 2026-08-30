"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { createClient } from "@/lib/supabase/client";
import {
  archiveFileLink,
  createArchiveUpload,
  deleteArchivedProposal,
  saveArchivedProposal,
  updateArchivedProposal,
} from "@/lib/actions/proposal-archive-actions";
import {
  ACCEPTED_TYPES,
  OUTCOMES,
  archiveLine,
  byJobDate,
  checkArchiveFile,
  summariseArchive,
  type ArchivedProposal,
} from "@/lib/proposal-archive";

const TONE: Record<string, string> = {
  won: "text-emerald-700 dark:text-emerald-400",
  lost: "text-muted-foreground",
  disputed: "text-destructive",
};

function money(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/**
 * The quotes this client got before this app existed.
 *
 * The upload goes straight to storage from the browser with a signed URL. A
 * scanned quote is several megabytes and a Server Action carries one, so
 * sending the file through the app would fail on exactly the documents worth
 * keeping.
 *
 * The outcome is asked for on the way in rather than left for later. A pile
 * of PDFs with nothing said about them is a filing cabinet; the reason to
 * carry these across is that each one says whether we got the work, and the
 * ones we did not are a list worth working through.
 */
export function ArchivedProposalsPanel({
  customerId,
  proposals,
}: {
  customerId: string;
  proposals: ArchivedProposal[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // The file waits for its details rather than uploading on pick, so nothing
  // lands in storage that never gets an outcome against it.
  const [file, setFile] = useState<File | null>(null);
  const [outcome, setOutcome] = useState<string>("won");
  const [jobDate, setJobDate] = useState("");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  const summary = summariseArchive(proposals);
  const shown = byJobDate(proposals);

  function pick(chosen: File | null) {
    setError(null);
    if (!chosen) return;
    const check = checkArchiveFile({ type: chosen.type, size: chosen.size });
    if (!check.ok) {
      setError(check.message);
      return;
    }
    setFile(chosen);
    if (!title) setTitle(chosen.name.replace(/\.[^.]+$/, ""));
  }

  function reset() {
    setFile(null);
    setTitle("");
    setJobDate("");
    setAmount("");
    setNotes("");
    setOutcome("won");
    if (fileRef.current) fileRef.current.value = "";
  }

  function save() {
    if (!file) return;
    setError(null);
    setBusy("Uploading…");
    start(async () => {
      const slot = await createArchiveUpload({
        customerId,
        fileType: file.type,
        fileSize: file.size,
      });
      if (!slot.ok) {
        setBusy(null);
        setError(slot.message);
        return;
      }

      const upload = await createClient()
        .storage.from("proposal-archive")
        .uploadToSignedUrl(slot.path, slot.token, file);
      if (upload.error) {
        setBusy(null);
        setError(upload.error.message);
        return;
      }

      const saved = await saveArchivedProposal({
        customerId,
        filePath: slot.path,
        fileName: file.name,
        outcome,
        jobDate,
        title,
        amount,
        notes,
      });
      setBusy(null);
      if (saved.ok) {
        reset();
        router.refresh();
      } else {
        setError(saved.message);
      }
    });
  }

  function openFile(filePath: string) {
    start(async () => {
      const link = await archiveFileLink(filePath);
      if (link.ok) window.open(link.url, "_blank", "noopener");
      else setError(link.message);
    });
  }

  function changeOutcome(id: string, next: string) {
    start(async () => {
      const result = await updateArchivedProposal(id, customerId, { outcome: next });
      if (result.ok) router.refresh();
      else setError(result.message);
    });
  }

  function remove(id: string, filePath: string, name: string) {
    if (!confirm(`Delete "${name}"? The file goes too.`)) return;
    start(async () => {
      const result = await deleteArchivedProposal(id, customerId, filePath);
      if (result.ok) router.refresh();
      else setError(result.message);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Older quotes</h3>
        <span className="text-xs text-muted-foreground">
          {archiveLine(summary)}
          {summary.wonValueCents != null && ` ${money(summary.wonValueCents / 100)} won.`}
        </span>
      </div>

      {shown.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {shown.map((row) => (
            <li
              key={row.id}
              className="flex items-start gap-2 rounded-lg border border-white/60 bg-card/70 p-2.5"
            >
              <button
                type="button"
                onClick={() => openFile(row.filePath)}
                className="flex min-w-0 flex-1 items-start gap-2 text-left"
              >
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {row.title || row.fileName}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {row.jobDate ?? "No date yet"}
                    {row.amount != null && ` · ${money(row.amount)}`}
                  </span>
                </span>
              </button>

              {/* Changing the outcome is the edit that actually gets made:
                  these are typed in from memory while looking at an old file,
                  and "we got it" turns into "we didn't" more than once. */}
              <select
                value={row.outcome}
                onChange={(e) => changeOutcome(row.id, e.target.value)}
                disabled={pending}
                className={`h-8 shrink-0 rounded-md border border-input bg-card/80 px-1.5 text-xs ${TONE[row.outcome] ?? ""}`}
                aria-label={`Outcome for ${row.title || row.fileName}`}
              >
                {OUTCOMES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => remove(row.id, row.filePath, row.title || row.fileName)}
                disabled={pending}
                className="shrink-0 text-muted-foreground hover:text-destructive"
                aria-label={`Delete ${row.title || row.fileName}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!file ? (
        <>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED_TYPES.join(",")}
            className="hidden"
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="self-start"
            onClick={() => fileRef.current?.click()}
          >
            <Plus className="h-4 w-4" />
            Add an old quote
          </Button>
        </>
      ) : (
        <div className="flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
          <p className="truncate text-sm font-semibold">{file.name}</p>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">What happened?</span>
            <div className="flex flex-wrap gap-1.5">
              {OUTCOMES.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setOutcome(o.value)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                    outcome === o.value
                      ? "border-transparent bg-foreground text-background"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Date of the job</span>
            <Input
              type="date"
              value={jobDate}
              onChange={(e) => setJobDate(e.target.value)}
              className="h-9 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">What was it for</span>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Back garden rebuild"
              className="h-9 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              What we quoted (optional)
            </span>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="4200"
              className="h-9 w-32 text-sm"
            />
          </label>

          <AutoTextarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={1}
            placeholder="Anything worth remembering (optional)"
            className="min-h-9 py-2 text-sm"
          />

          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={pending} onClick={save}>
              {pending ? (busy ?? "Saving…") : "Save this quote"}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={reset}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
