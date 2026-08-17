"use client";

import { useState, useTransition } from "react";
import { Ban, Loader2, Sprout, Upload, UserCheck, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  deleteProspectBatch,
  enrichProspects,
  growProspectsNow,
  importProspects,
  reconcileProspectsNow,
  setDoNotContact,
  setProspectStatus,
} from "@/lib/actions/prospect-actions";
import type { ProspectRow } from "@/lib/data/prospects";

function money(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function ProspectPanel({
  prospects,
  batches,
  rentcastReady,
}: {
  prospects: ProspectRow[];
  batches: string[];
  rentcastReady: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <GrowthPanel rentcastReady={rentcastReady} />
      <ProspectList prospects={prospects} />
      <details className="rounded-xl border border-white/60 bg-card/60 backdrop-blur-md">
        <summary className="cursor-pointer p-4 text-sm font-semibold">Import a list instead</summary>
        <div className="border-t border-border p-4 pt-3">
          <ImportForm batches={batches} rentcastReady={rentcastReady} />
        </div>
      </details>
    </div>
  );
}


function GrowthPanel({ rentcastReady }: { rentcastReady: boolean }) {
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
        <Sprout className="h-4 w-4" />
        Growing itself
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Every night the list grows around your finished work — the houses near a job you just completed become
        candidates, biggest and most recent jobs first. Anything already a client, already listed, or on too
        small a lot is dropped. Nothing to upload.
      </p>

      {!rentcastReady && (
        <p className="mb-3 rounded-lg border border-amber-400/70 bg-amber-50/60 px-3 py-2 text-xs">
          Add <code>RENTCAST_API_KEY</code> to the server environment and this starts working. Without it the
          list can only be filled by importing a file.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={isPending || !rentcastReady}
          onClick={() =>
            startTransition(async () => {
              const result = await growProspectsNow();
              setMessage(result.ok ? (result.message ?? "Done.") : result.message);
            })
          }
        >
          {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Grow now
        </Button>

        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await reconcileProspectsNow();
              setMessage(result.ok ? (result.message ?? "Done.") : result.message);
            })
          }
        >
          <UserCheck className="mr-1.5 h-3.5 w-3.5" />
          Check against clients
        </Button>
      </div>

      {message && <p className="mt-2 text-xs">{message}</p>}
    </section>
  );
}

function ImportForm({ batches, rentcastReady }: { batches: string[]; rentcastReady: boolean }) {
  const [csv, setCsv] = useState("");
  const [batchName, setBatchName] = useState("");
  const [minAcreage, setMinAcreage] = useState("0.5");
  const [zips, setZips] = useState("");
  const [requireOwner, setRequireOwner] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function readFile(file: File) {
    setCsv(await file.text());
    if (!batchName) setBatchName(file.name.replace(/\.csv$/i, ""));
  }

  return (
    <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
        <Upload className="h-4 w-4" />
        Import a list
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Any CSV with an address column — a Harford County or Maryland SDAT parcel export, or a list from a
        vendor. Columns are matched by name, and anything already a client is skipped.
      </p>

      <div className="flex flex-col gap-3">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void readFile(file);
          }}
          className="text-xs"
        />

        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={4}
          placeholder="…or paste CSV here"
          className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-mono"
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs font-medium">
            Batch name
            <Input value={batchName} onChange={(e) => setBatchName(e.target.value)} placeholder="Bel Air 21014" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Min acres
            <Input
              type="number"
              step="0.1"
              min="0"
              value={minAcreage}
              onChange={(e) => setMinAcreage(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Zips (comma separated)
            <Input value={zips} onChange={(e) => setZips(e.target.value)} placeholder="21014, 21015" />
          </label>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={requireOwner}
            onChange={(e) => setRequireOwner(e.target.checked)}
            className="h-3.5 w-3.5 accent-primary"
          />
          Only rows with an owner name (skips commercial and blank parcels)
        </label>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={isPending || !csv.trim()}
            onClick={() =>
              startTransition(async () => {
                const result = await importProspects(csv, batchName, {
                  minAcreage: minAcreage ? Number(minAcreage) : null,
                  zips: zips
                    .split(",")
                    .map((z) => z.trim())
                    .filter(Boolean),
                  requireOwner,
                });
                if (!result.ok) {
                  setMessage(result.message);
                } else {
                  setCsv("");
                  setMessage(
                    `Imported ${result.imported}. Skipped ${result.skippedExisting} already on the books` +
                      (result.skippedRows > 0 ? `, ${result.skippedRows} unusable rows` : "") +
                      (result.unmapped.length > 0 ? `. Unrecognised columns: ${result.unmapped.join(", ")}` : ".")
                  );
                }
              })
            }
          >
            {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Import
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending || !rentcastReady}
            title={rentcastReady ? undefined : "Add RENTCAST_API_KEY to enable"}
            onClick={() =>
              startTransition(async () => {
                const result = await enrichProspects(20);
                setMessage(result.ok ? (result.message ?? "Done.") : result.message);
              })
            }
          >
            <Wand2 className="mr-1.5 h-3.5 w-3.5" />
            Fill in lot sizes (20)
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await reconcileProspectsNow();
                setMessage(result.ok ? (result.message ?? "Done.") : result.message);
              })
            }
          >
            <UserCheck className="mr-1.5 h-3.5 w-3.5" />
            Check against clients
          </Button>
        </div>

        {message && <p className="text-xs">{message}</p>}

        {batches.length > 0 && (
          <div className="border-t border-border pt-2">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Batches</p>
            <div className="flex flex-wrap gap-2">
              {batches.map((batch) => (
                <button
                  key={batch}
                  type="button"
                  disabled={isPending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await deleteProspectBatch(batch);
                      setMessage(result.ok ? `Removed “${batch}”.` : result.message);
                    })
                  }
                  className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-accent"
                >
                  {batch} · remove
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function ProspectList({ prospects }: { prospects: ProspectRow[] }) {
  if (prospects.length === 0) {
    return (
      <section className="rounded-xl border border-white/60 bg-card/60 p-4 text-sm text-muted-foreground backdrop-blur-md">
        No prospects yet. Import a list above.
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <h2 className="mb-3 text-sm font-semibold">Prospects ({prospects.length})</h2>
      <ul className="flex flex-col gap-2">
        {prospects.map((prospect) => (
          <ProspectRowItem key={prospect.id} prospect={prospect} />
        ))}
      </ul>
    </section>
  );
}

function ProspectRowItem({ prospect }: { prospect: ProspectRow }) {
  const [status, setStatus] = useState(prospect.status);
  const [blocked, setBlocked] = useState(prospect.doNotContact);
  const [isPending, startTransition] = useTransition();

  return (
    <li className={`rounded-lg border p-2.5 ${blocked ? "border-destructive/40 bg-destructive/5" : "border-border"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="font-medium">{prospect.ownerName ?? "Owner unknown"}</span>
        <span className="text-sm font-semibold tabular-nums">
          {prospect.estimatedTicket != null ? `${money(prospect.estimatedTicket)} est.` : "—"}
        </span>
      </div>
      <p className="truncate text-xs text-muted-foreground">
        {[prospect.address, prospect.city, prospect.zip].filter(Boolean).join(", ")}
      </p>
      <p className="text-[11px] text-muted-foreground">
        {[
          prospect.acreage != null ? `${prospect.acreage.toFixed(2)} acres` : "lot size unknown",
          prospect.phone,
          prospect.batch,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>

      {blocked ? (
        <p className="mt-1 text-[11px] font-semibold text-destructive">Do not contact</p>
      ) : status === "converted" ? (
        <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
          <UserCheck className="h-3.5 w-3.5" />
          Already a client — off the call list
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {(["new", "queued", "contacted", "converted", "rejected"] as const).map((option) => (
            <button
              key={option}
              type="button"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  setStatus(option);
                  await setProspectStatus(prospect.id, option);
                })
              }
              className={`min-h-8 rounded-md border px-2 py-1 text-[11px] font-medium capitalize ${
                status === option ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent"
              }`}
            >
              {option}
            </button>
          ))}
          <button
            type="button"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                setBlocked(true);
                await setDoNotContact(prospect.id, "Asked not to be contacted");
              })
            }
            className="ml-auto flex items-center gap-1 rounded-md p-1.5 text-[11px] text-muted-foreground hover:text-destructive"
          >
            <Ban className="h-3.5 w-3.5" />
            Do not contact
          </button>
        </div>
      )}
    </li>
  );
}
