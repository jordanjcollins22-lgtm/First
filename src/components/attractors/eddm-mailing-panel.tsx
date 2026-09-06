"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Mail, Printer, Trash2, Waves } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createEddmMailing, setEddmMailingStatus, updateEddmRates } from "@/lib/actions/eddm-mailing-actions";
import type { EddmMailing } from "@/lib/data/eddm";
import type { EddmRouteFeature } from "@/lib/eddm";
import { mailingSummary, piecesFor, suggestedName, type Audience, type MailingRates, type MailingRoute } from "@/lib/eddm-mailing";

/**
 * An EDDM mailing, built from routes ticked on the map.
 *
 * Everything the order needs is worked out here as routes go in and out:
 * pieces, postage at the rate USPS charges, printing at what it costs us to
 * print in-house, the post office, and whether USPS would accept it. Saving
 * opens the order package to print; what is left is paying USPS.
 */
export function EddmMailingPanel({
  selected,
  rates,
  mailings,
  onRemove,
  onClear,
  onMakeWave,
}: {
  selected: EddmRouteFeature[];
  rates: MailingRates;
  mailings: EddmMailing[];
  onRemove: (id: string) => void;
  onClear: () => void;
  /** The routes' combined outline, with a name and the piece count, to the wave form. */
  onMakeWave: (routes: EddmRouteFeature[], name: string, quantity: number) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [audience, setAudience] = useState<Audience>("residential");
  const [name, setName] = useState("");
  const [postage, setPostage] = useState(rates.postagePerPiece?.toString() ?? "");
  const [print, setPrint] = useState(rates.printCostPerPiece.toString());
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const routes: MailingRoute[] = selected.map((f) => ({
    zip: f.properties.zip,
    routeId: f.properties.routeId,
    residential: f.properties.residential,
    business: f.properties.business,
    total: f.properties.total,
    facility: f.properties.facility,
  }));
  const liveRates: MailingRates = {
    postagePerPiece: postage.trim() === "" ? null : Number(postage),
    printCostPerPiece: Number(print) || 0,
  };
  const summary = mailingSummary(routes, audience, liveRates);
  const dollars = (c: number) => `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const mailingName = name.trim() || suggestedName(routes);

  function saveRates() {
    setError(null);
    startTransition(async () => {
      const result = await updateEddmRates(liveRates);
      if (!result.ok) setError(result.error);
      else setNote("Rates saved.");
    });
  }

  function saveMailing() {
    setError(null);
    startTransition(async () => {
      const result = await createEddmMailing({ name: mailingName, audience, routes });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      window.open(`/eddm/mailings/${result.value.id}/order`, "_blank", "noopener");
      router.refresh();
      setNote("Mailing saved. The order package opened in a new tab.");
    });
  }

  function setStatus(id: string, status: "planned" | "printed" | "mailed") {
    startTransition(async () => {
      const result = await setEddmMailingStatus(id, status);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-base font-semibold">
          <Mail className="h-4 w-4" />
          EDDM mailing
        </h2>
        {selected.length > 0 && (
          <Button type="button" size="sm" variant="ghost" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {note && <p className="text-sm text-emerald-700">{note}</p>}

      {selected.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Load a ZIP&apos;s USPS routes, click a route, and press &ldquo;Add to mailing&rdquo;.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-1 text-sm">
            {selected.map((f) => (
              <li key={f.properties.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1">
                <span>
                  <span className="font-mono font-semibold">
                    {f.properties.zip} {f.properties.routeId}
                  </span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {piecesFor(
                      {
                        zip: f.properties.zip,
                        routeId: f.properties.routeId,
                        residential: f.properties.residential,
                        business: f.properties.business,
                        total: f.properties.total,
                        facility: f.properties.facility,
                      },
                      audience
                    ).toLocaleString()}{" "}
                    pieces
                    {f.properties.under200 ? " · under 200" : ""}
                  </span>
                </span>
                <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => onRemove(f.properties.id)} aria-label="Remove route">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap gap-3 text-xs">
            <label className="flex items-center gap-1">
              <input type="radio" checked={audience === "residential"} onChange={() => setAudience("residential")} />
              Homes only
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" checked={audience === "all"} onChange={() => setAudience("all")} />
              Homes and businesses
            </label>
          </div>

          <div className="rounded-lg bg-muted/40 p-3 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 tabular-nums">
              <dt>Pieces</dt>
              <dd className="text-right font-semibold">{summary.pieces.toLocaleString()}</dd>
              <dt>Postage</dt>
              <dd className="text-right">{summary.postageCents != null ? dollars(summary.postageCents) : "enter the rate below"}</dd>
              <dt>Printing (in-house)</dt>
              <dd className="text-right">{dollars(summary.printCents)}</dd>
              <dt className="font-semibold">Total</dt>
              <dd className="text-right font-semibold">{summary.totalCents != null ? dollars(summary.totalCents) : "—"}</dd>
              <dt>Bundles</dt>
              <dd className="text-right">{summary.bundles}</dd>
              <dt>Drop at</dt>
              <dd className="text-right">{summary.facilities.join(", ") || "—"}</dd>
            </dl>
            {summary.perZip.filter((z) => !z.ok).map((z) => (
              <p key={z.zip} className="mt-1 text-xs font-medium text-amber-800">
                {z.problem}
              </p>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="eddm-name" className="text-xs">
              Mailing name
            </Label>
            <Input id="eddm-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={suggestedName(routes)} className="text-sm" />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={isPending} onClick={saveMailing}>
              <Printer className="mr-1 h-3.5 w-3.5" />
              Save &amp; open order package
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={() => onMakeWave(selected, mailingName, summary.pieces)}>
              <Waves className="mr-1 h-3.5 w-3.5" />
              Make a wave
            </Button>
            <a
              href="https://eddm.usps.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-3 text-xs font-medium"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Pay postage at USPS
            </a>
          </div>
        </>
      )}

      {/* The rates every mailing is priced at. */}
      <div className="rounded-lg border border-border p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rates, per piece</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="eddm-postage" className="text-xs">
              USPS postage ($)
            </Label>
            <Input id="eddm-postage" value={postage} onChange={(e) => setPostage(e.target.value)} placeholder="0.222" inputMode="decimal" className="text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="eddm-print" className="text-xs">
              In-house printing ($)
            </Label>
            <Input id="eddm-print" value={print} onChange={(e) => setPrint(e.target.value)} placeholder="0.08" inputMode="decimal" className="text-sm" />
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">USPS revises the EDDM Retail rate once or twice a year; check it at usps.com.</p>
          <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={saveRates}>
            Save rates
          </Button>
        </div>
      </div>

      {mailings.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mailings</p>
          <ul className="flex flex-col gap-1 text-sm">
            {mailings.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-2 py-1">
                <span>
                  <span className="font-medium">{m.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {m.pieces.toLocaleString()} pieces · {m.status}
                    {m.mailedOn ? ` ${m.mailedOn}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  <a href={`/eddm/mailings/${m.id}/order`} target="_blank" rel="noopener noreferrer" className="text-xs underline">
                    Order package
                  </a>
                  {m.status === "planned" && (
                    <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => setStatus(m.id, "printed")}>
                      Printed
                    </Button>
                  )}
                  {m.status !== "mailed" && (
                    <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => setStatus(m.id, "mailed")}>
                      Mailed
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
