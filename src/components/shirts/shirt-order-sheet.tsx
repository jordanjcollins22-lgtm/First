"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ChevronLeft, Download, Loader2, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ShirtMockup } from "@/components/shirts/shirt-mockup";
import { setShirtOrderStatus } from "@/lib/actions/shirt-order-actions";
import { SHIRT_SIZES, SHIRT_STATUS_LABEL, groupShirts, shirtArt, shirtColor, shirtDesign, styleLabel, totalShirts } from "@/lib/shirts";
import type { ShirtOrder } from "@/lib/data/shirt-orders";

/**
 * One shirt order as a print shop wants it: each design in each colour with
 * the front and back, where each print goes and how wide, the count of every
 * size, and the print files to download. Then Ordered, and Received.
 */
export function ShirtOrderSheet({ order }: { order: ShirtOrder }) {
  const [status, setStatus] = useState(order.status);
  const [printerNote, setPrinterNote] = useState(order.printerNote ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const groups = groupShirts(order.lines);
  const sizesUsed = SHIRT_SIZES.filter((s) => groups.some((g) => g.sizes[s]));

  const move = (next: "ordered" | "received" | "cancelled" | "placed") =>
    start(async () => {
      setError(null);
      const result = await setShirtOrderStatus(order.id, next, printerNote);
      if (!result.ok) return setError(result.message);
      setStatus(next);
    });

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-6 print:max-w-none print:p-0">
      <Link href="/admin/shirts" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary print:hidden">
        <ChevronLeft className="h-4 w-4" /> Company shirts
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Shirt order · JS Landscaping</h1>
          <p className="text-sm text-muted-foreground">
            {new Date(order.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} · {totalShirts(order.lines)} shirts
            {order.by ? ` · ordered by ${order.by}` : ""}
          </p>
          {order.note && <p className="mt-1 text-sm">{order.note}</p>}
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">{SHIRT_STATUS_LABEL[status]}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="mr-1.5 h-4 w-4" /> Print
          </Button>
        </div>
      </header>

      {groups.map((g) => {
        const d = shirtDesign(g.design)!;
        const c = shirtColor(g.color)!;
        return (
          <section key={`${g.design}-${g.style}-${g.color}`} className="break-inside-avoid rounded-2xl border border-border bg-card p-4">
            <div className="grid gap-4 sm:grid-cols-[260px_minmax(0,1fr)]">
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted/50 p-2">
                <ShirtMockup design={g.design} color={g.color} style={g.style} side="front" />
                <ShirtMockup design={g.design} color={g.color} style={g.style} side="back" />
              </div>
              <div className="flex flex-col gap-2 text-sm">
                <p className="text-base font-semibold">
                  {d.label} · {styleLabel(g.style)} · {c.label}
                </p>
                <ul className="text-muted-foreground">
                  {(["front", "back"] as const).map((side) => {
                    const p = side === "front" ? d.front : d.back;
                    return (
                      <li key={side}>
                        <span className="font-medium text-foreground">{side === "front" ? "Front" : "Back"}:</span>{" "}
                        {p ? (
                          <>
                            {p.placement}, {p.widthIn}&quot; wide.{" "}
                            <a href={shirtArt(p, c, "print")} download className="inline-flex items-center gap-0.5 text-primary underline print:no-underline">
                              <Download className="h-3.5 w-3.5 print:hidden" /> Print file
                            </a>
                          </>
                        ) : (
                          "nothing"
                        )}
                      </li>
                    );
                  })}
                </ul>
                <table className="mt-1 w-full max-w-md border-collapse text-center">
                  <thead>
                    <tr className="text-xs text-muted-foreground">
                      {sizesUsed.map((s) => (
                        <th key={s} className="border border-border px-2 py-1 font-medium">
                          {s}
                        </th>
                      ))}
                      <th className="border border-border px-2 py-1 font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="tabular-nums">
                      {sizesUsed.map((s) => (
                        <td key={s} className="border border-border px-2 py-1">
                          {g.sizes[s] ?? "—"}
                        </td>
                      ))}
                      <td className="border border-border px-2 py-1 font-semibold">{g.total}</td>
                    </tr>
                  </tbody>
                </table>
                {g.names.length > 0 && <p className="text-xs text-muted-foreground">Names: {g.names.map((n) => `${n.name} (${n.size})`).join(", ")}</p>}
              </div>
            </div>
          </section>
        );
      })}

      <p className="text-xs text-muted-foreground">Print files are PNG at 300 dpi on a transparent background, at the width listed.</p>

      <section className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 print:hidden">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Print shop, quote or order number</span>
          <Textarea rows={2} value={printerNote} onChange={(e) => setPrinterNote(e.target.value)} placeholder="Who it went to, what they quoted, when it's ready" maxLength={1000} />
        </label>
        <div className="flex flex-wrap gap-2">
          {status === "placed" && (
            <Button type="button" disabled={pending} onClick={() => move("ordered")}>
              {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Ordered from the printer
            </Button>
          )}
          {status === "ordered" && (
            <Button type="button" disabled={pending} onClick={() => move("received")}>
              {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Shirts received
            </Button>
          )}
          {status !== "placed" && status !== "cancelled" && (
            <Button type="button" variant="outline" disabled={pending} onClick={() => move(status === "received" ? "ordered" : "placed")}>
              Undo
            </Button>
          )}
          {status !== "cancelled" && status !== "received" && (
            <Button type="button" variant="ghost" disabled={pending} onClick={() => move("cancelled")}>
              Cancel order
            </Button>
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </section>
    </div>
  );
}
