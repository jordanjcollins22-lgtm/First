"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Minus, Plus, ShoppingBag, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ShirtMockup } from "@/components/shirts/shirt-mockup";
import { placeShirtOrder } from "@/lib/actions/shirt-order-actions";
import {
  SHIRT_DESIGNS,
  SHIRT_SIZES,
  SHIRT_STATUS_LABEL,
  SHIRT_STYLES,
  groupShirts,
  shirtColor,
  shirtDesign,
  styleLabel,
  totalShirts,
  type ShirtLine,
  type ShirtSide,
  type ShirtSize,
  type ShirtStyle,
} from "@/lib/shirts";
import type { ShirtOrder } from "@/lib/data/shirt-orders";
import { cn } from "@/lib/utils";

/**
 * Company shirts: the designs to look through, front and back in every
 * colour, then what we need filled in (a design, a style, a colour, how many
 * of each size, and who for), added up as an order and placed. Placing it
 * makes the order sheet for the print shop; nothing goes to anybody on its own.
 */
export function ShirtShop({ orders, canSave }: { orders: ShirtOrder[] | null; canSave: boolean }) {
  const router = useRouter();
  const [design, setDesign] = useState(SHIRT_DESIGNS[0].key);
  const [style, setStyle] = useState<ShirtStyle>("tee");
  const [color, setColor] = useState(SHIRT_DESIGNS[0].colors[0]);
  const [side, setSide] = useState<ShirtSide>("back");
  const [counts, setCounts] = useState<Partial<Record<ShirtSize, number>>>({});
  const [name, setName] = useState("");
  const [lines, setLines] = useState<ShirtLine[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const d = shirtDesign(design)!;
  const pick = (key: string) => {
    const next = shirtDesign(key)!;
    setDesign(key);
    if (!next.colors.includes(color)) setColor(next.colors[0]);
    setSide(next.back ? "back" : "front");
  };
  const adding = SHIRT_SIZES.reduce((s, size) => s + (counts[size] ?? 0), 0);

  function add() {
    if (adding === 0) return setError("Put in how many of at least one size.");
    setError(null);
    const who = name.trim() || null;
    setLines((ls) => [...ls, ...SHIRT_SIZES.filter((s) => (counts[s] ?? 0) > 0).map((size) => ({ design, style, color, size, quantity: counts[size]!, name: who }))]);
    setCounts({});
    setName("");
  }

  function place() {
    setError(null);
    start(async () => {
      const result = await placeShirtOrder({ lines, note });
      if (!result.ok) return setError(result.message);
      router.push(`/admin/shirts/${result.id}`);
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
      <header>
        <h1 className="text-xl font-semibold">Company shirts</h1>
        <p className="mt-1 text-sm text-muted-foreground">Pick a design, a style and a colour, put in how many of each size, and add it to the order. Placing the order makes the sheet to send to the print shop, with the print files.</p>
      </header>

      {!canSave && (
        <p className="rounded-xl border border-amber-400 bg-amber-50/70 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          Orders can&apos;t be saved yet: database update 0338 hasn&apos;t been applied. You can look through the designs and fill one in.
        </p>
      )}

      {/* 1. The designs. */}
      <section className="grid gap-3 md:grid-cols-3">
        {SHIRT_DESIGNS.map((x) => {
          const on = x.key === design;
          return (
            <button
              key={x.key}
              type="button"
              onClick={() => pick(x.key)}
              aria-pressed={on}
              className={cn("flex flex-col gap-2 rounded-2xl border bg-card p-3 text-left transition-colors", on ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/40")}
            >
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted/50 p-2">
                <ShirtMockup design={x.key} color={on ? color : x.colors[0]} style={on ? style : "tee"} side="front" />
                <ShirtMockup design={x.key} color={on ? color : x.colors[0]} style={on ? style : "tee"} side="back" />
              </div>
              <p className="font-semibold">{x.label}</p>
              <p className="text-xs text-muted-foreground">{x.blurb}</p>
            </button>
          );
        })}
      </section>

      {/* 2. Fill in what we need. */}
      <section className="grid gap-4 rounded-2xl border border-border bg-card p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="flex flex-col gap-2">
          <div className="rounded-xl bg-muted/50 p-3">
            <ShirtMockup design={design} color={color} style={style} side={side} className="mx-auto w-full max-w-xs" />
          </div>
          <div className="flex justify-center gap-2">
            {(["front", "back"] as const).map((s) => (
              <button key={s} type="button" onClick={() => setSide(s)} className={cn("rounded-full px-3 py-1 text-sm font-medium", side === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                {s === "front" ? "Front" : "Back"}
              </button>
            ))}
          </div>
          {!(side === "front" ? d.front : d.back) && <p className="text-center text-xs text-muted-foreground">Nothing printed on the {side}.</p>}
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <p className="text-sm font-semibold">{d.label}</p>
            <p className="text-xs text-muted-foreground">
              {[d.front && `Front: ${d.front.placement.toLowerCase()}, ${d.front.widthIn}" wide`, d.back && `Back: ${d.back.placement.toLowerCase()}, ${d.back.widthIn}" wide`].filter(Boolean).join(" · ")}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">Style</p>
            <div className="flex flex-wrap gap-2">
              {SHIRT_STYLES.map((s) => (
                <button key={s.key} type="button" onClick={() => setStyle(s.key)} aria-pressed={style === s.key} className={cn("h-10 rounded-lg border px-3 text-sm font-medium", style === s.key ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/40")}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">
              Colour <span className="font-normal text-muted-foreground">· {shirtColor(color)?.label}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {d.colors.map((key) => {
                const c = shirtColor(key)!;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setColor(key)}
                    aria-pressed={color === key}
                    aria-label={c.label}
                    title={c.label}
                    className={cn("h-10 w-10 rounded-full border-2 shadow-sm", color === key ? "border-primary ring-2 ring-primary/40 ring-offset-2" : "border-border")}
                    style={{ backgroundColor: c.hex }}
                  />
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">How many of each size</p>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
              {SHIRT_SIZES.map((size) => {
                const n = counts[size] ?? 0;
                return (
                  <div key={size} className={cn("flex flex-col items-center gap-1 rounded-lg border p-1.5", n > 0 ? "border-primary bg-primary/5" : "border-border")}>
                    <span className="text-xs font-semibold">{size}</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={500}
                      value={n === 0 ? "" : n}
                      placeholder="0"
                      onChange={(e) => setCounts((c) => ({ ...c, [size]: Math.max(0, Math.min(500, Math.round(Number(e.target.value) || 0))) }))}
                      aria-label={`How many ${size}`}
                      className="h-9 w-full rounded-md border border-input bg-background text-center text-base tabular-nums"
                    />
                    <div className="flex gap-1">
                      <button type="button" aria-label={`One less ${size}`} onClick={() => setCounts((c) => ({ ...c, [size]: Math.max(0, n - 1) }))} className="rounded p-0.5 text-muted-foreground hover:bg-muted">
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" aria-label={`One more ${size}`} onClick={() => setCounts((c) => ({ ...c, [size]: Math.min(500, n + 1) }))} className="rounded p-0.5 text-primary hover:bg-muted">
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">
              Who it&apos;s for <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jace, or leave blank for spares" maxLength={60} />
          </label>

          <Button type="button" variant="outline" className="h-11 font-semibold" onClick={add}>
            <Plus className="mr-1.5 h-4 w-4" /> Add {adding > 0 ? `${adding} ` : ""}to the order
          </Button>
        </div>
      </section>

      {/* 3. The order, added up. */}
      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
        <h2 className="flex items-center gap-1.5 text-base font-semibold">
          <ShoppingBag className="h-5 w-5 text-primary" /> The order <span className="font-normal text-muted-foreground">({totalShirts(lines)} shirts)</span>
        </h2>
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing added yet.</p>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {groupShirts(lines).map((g) => (
                <li key={`${g.design}-${g.style}-${g.color}`} className="flex items-start gap-3 py-2">
                  <div className="w-16 shrink-0 rounded-lg bg-muted/50 p-1">
                    <ShirtMockup design={g.design} color={g.color} style={g.style} side="front" />
                  </div>
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium">
                      {shirtDesign(g.design)?.label} · {styleLabel(g.style)} · {shirtColor(g.color)?.label}
                    </p>
                    <p className="text-muted-foreground">
                      {SHIRT_SIZES.filter((s) => g.sizes[s]).map((s) => `${g.sizes[s]} ${s}`).join(", ")} · {g.total} total
                    </p>
                    {g.names.length > 0 && <p className="text-xs text-muted-foreground">For {g.names.map((n) => `${n.name} (${n.size})`).join(", ")}</p>}
                  </div>
                </li>
              ))}
            </ul>
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">Change or remove a line</summary>
              <ul className="mt-2 flex flex-col gap-1">
                {lines.map((l, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-2 py-1">
                    <span>
                      {l.quantity} × {shirtDesign(l.design)?.label} {styleLabel(l.style).toLowerCase()}, {shirtColor(l.color)?.label.toLowerCase()}, {l.size}
                      {l.name ? ` · ${l.name}` : ""}
                    </span>
                    <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Remove" className="rounded p-1 text-muted-foreground hover:bg-muted">
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </details>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything for the print shop: when we need them by, a quote to beat…" rows={2} maxLength={1000} />
            <Button type="button" className="h-12 text-base font-semibold" disabled={pending || !canSave} onClick={place}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Place order for {totalShirts(lines)} shirts
            </Button>
            <p className="text-center text-xs text-muted-foreground">Nothing is sent to the print shop. It makes the order sheet and print files to send them.</p>
          </>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </section>

      {/* 4. Past orders. */}
      {orders && orders.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">Orders</h2>
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={`/admin/shirts/${o.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40">
                  <span className="text-sm">
                    <span className="font-medium">{new Date(o.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {totalShirts(o.lines)} shirts{o.by ? ` · ${o.by.split(/\s+/)[0]}` : ""}
                    </span>
                  </span>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", o.status === "placed" ? "bg-amber-100 text-amber-900" : o.status === "received" ? "bg-emerald-100 text-emerald-900" : "bg-muted text-muted-foreground")}>
                    {SHIRT_STATUS_LABEL[o.status]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
