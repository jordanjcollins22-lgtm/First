"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Package, Printer, RotateCcw } from "lucide-react";

import { PrintPdfButton } from "@/components/print/print-pdf-button";
import { printPlan, TRAYS, type TrayKey } from "@/lib/flyer-print";

/**
 * Printing a mailing's flyers, from a phone next to the printer.
 *
 * Three things, in the order somebody standing at the printer needs them:
 * how much paper to take off the shelf, how to set the printer, and then one
 * button per tray of paper. Each button sends exactly that tray's flyers, so
 * nobody types a number of copies, and the next one is ready when the tray
 * runs out. How far the run has got is kept on this phone, so closing the
 * page halfway picks up at the next flyer.
 */
export function FlyerPrintRun({
  mailingId,
  pieces,
  paper,
  printer,
  runName,
}: {
  mailingId: string;
  pieces: number;
  paper: string | null;
  printer: string | null;
  runName: string | null;
}) {
  const key = `flyer-print:${mailingId}`;
  const [tray, setTray] = useState<TrayKey>("bypass");
  const [printed, setPrinted] = useState(0);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null") as { printed?: number; tray?: TrayKey } | null;
      // Read once on open: storage is outside React and not there on the server.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved?.printed) setPrinted(saved.printed);
      if (saved?.tray && saved.tray in TRAYS) setTray(saved.tray);
    } catch {
      // Private window or blocked storage: start from the first flyer.
    }
  }, [key]);

  function remember(next: { printed?: number; tray?: TrayKey }) {
    const value = { printed: next.printed ?? printed, tray: next.tray ?? tray };
    if (next.printed != null) setPrinted(next.printed);
    if (next.tray) setTray(next.tray);
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Not saved; the page still works for this visit.
    }
  }

  const plan = printPlan(pieces, TRAYS[tray].sheets, printed);
  const next = plan.loads[0] ?? null;
  const pdf = (from: number, count: number) => `/eddm/mailings/${mailingId}/print/pdf?from=${from}&count=${count}`;
  const percent = plan.sheets ? Math.round((plan.printed / plan.sheets) * 100) : 0;
  const paperName = paper ?? "flyer paper";

  return (
    <div className="space-y-4">
      <section className="rounded-xl border bg-card p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">1 · Set this paper aside</p>
        <div className="mt-2 flex items-center gap-3">
          <Package className="h-8 w-8 shrink-0 text-primary" />
          <div>
            <p className="text-3xl font-bold tabular-nums">{plan.sheets.toLocaleString()} sheets</p>
            <p className="text-sm">{paperName}</p>
          </div>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          One flyer per sheet, printed on both sides. That&apos;s {plan.packs} pack{plan.packs === 1 ? "" : "s"} of 500
          {plan.leftInLastPack > 0 ? `, with ${plan.leftInLastPack} sheets left in the last one to go back on the shelf` : ""}.
        </p>
      </section>

      <section className="rounded-xl border bg-card p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">2 · Set up the printer</p>
        {printer && <p className="mt-1 text-sm font-medium">{printer}</p>}
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {(Object.keys(TRAYS) as TrayKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => remember({ tray: k })}
              className={`rounded-lg border-2 p-2 text-left text-sm ${tray === k ? "border-primary bg-primary/10" : "border-border"}`}
            >
              <span className="font-medium">{TRAYS[k].label}</span>
              <span className="block text-xs text-muted-foreground">{TRAYS[k].sheets} sheets at a time</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          This paper is 120 g (about 32 lb bond). Brother rates the main tray up to 28 lb and the bypass tray up to 43 lb,
          so the bypass tray is the one made for it.
        </p>
        <ul className="mt-3 space-y-1 text-sm">
          <li>• Paper size: <strong>Letter</strong></li>
          <li>• Two-sided: <strong>on, flip on long edge</strong></li>
          <li>• Scale: <strong>Actual size (100%)</strong>, not Fit to page</li>
          <li>• Paper type: <strong>Glossy</strong></li>
        </ul>
        {plan.printed === 0 && plan.sheets > 0 && (
          <div className="mt-3 rounded-lg border border-dashed p-3">
            <p className="text-sm">Print one first and check it: the back is the right way up, nothing is cut off, and the code scans.</p>
            <div className="mt-2">
              <PrintPdfButton href={pdf(1, 1)} label="Print one test flyer" fallbackName="flyer-test.pdf" />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">The test sheet doesn&apos;t count toward the {plan.sheets.toLocaleString()}; take one more sheet for it.</p>
          </div>
        )}
      </section>

      <section className="rounded-xl border bg-card p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">3 · Print, one tray at a time</p>
        {runName && <p className="mt-1 text-xs text-muted-foreground">With the paid adverts from {runName}.</p>}
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-1 text-sm tabular-nums">
          {plan.printed.toLocaleString()} of {plan.sheets.toLocaleString()} printed
          {plan.loads.length > 0 ? ` · ${plan.loads.length} tray${plan.loads.length === 1 ? "" : "s"} to go` : ""}
        </p>

        {next ? (
          <div className="mt-3 rounded-lg border-2 border-primary p-3">
            <p className="text-sm font-semibold">
              Put {next.sheets} sheets in the {tray === "bypass" ? "bypass" : "main"} tray
            </p>
            <p className="text-xs text-muted-foreground tabular-nums">
              Flyers {next.from.toLocaleString()} to {next.to.toLocaleString()}
            </p>
            <div className="mt-2 flex flex-wrap items-start gap-2">
              <PrintPdfButton
                href={pdf(next.from, next.sheets)}
                label={`Print these ${next.sheets}`}
                fallbackName={`flyers-${next.from}-to-${next.to}.pdf`}
                className="px-4 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => remember({ printed: next.to })}
                className="flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm"
              >
                <Check className="h-4 w-4" />
                They&apos;re out, next tray
              </button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Press Print in the window that opens. When the tray is empty and the last sheet is out, tap &ldquo;next tray&rdquo;.
            </p>
          </div>
        ) : (
          plan.sheets > 0 && (
            <div className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
              <p className="font-semibold">All {plan.sheets.toLocaleString()} flyers are printed.</p>
              <p className="mt-1">
                Next: tie them in bundles of 100 with a facing slip on each.{" "}
                <Link href={`/eddm/mailings/${mailingId}/order`} className="font-medium underline">
                  Print the facing slips
                </Link>
              </p>
            </div>
          )
        )}

        {plan.loads.length > 1 && (
          <ul className="mt-3 space-y-0.5 text-xs text-muted-foreground tabular-nums">
            {plan.loads.slice(1).map((load) => (
              <li key={load.from}>
                <Printer className="mr-1 inline h-3 w-3" />
                Then flyers {load.from.toLocaleString()} to {load.to.toLocaleString()} ({load.sheets} sheets)
              </li>
            ))}
          </ul>
        )}

        {plan.printed > 0 && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Start the count again from flyer 1?")) remember({ printed: 0 });
            }}
            className="mt-3 flex items-center gap-1 text-xs text-muted-foreground underline"
          >
            <RotateCcw className="h-3 w-3" />
            Start the count again
          </button>
        )}
      </section>
    </div>
  );
}
