"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Printer, QrCode } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { issueCode } from "@/lib/actions/inventory-tracking-actions";

export interface LabelItem {
  id: string;
  name: string;
  kind: "tool" | "material";
  code: string | null;
  /** Rendered on the server so the sheet is plain HTML by the time it prints. */
  qr: string | null;
  onHand: number | null;
  unit: string;
}

export interface PlaceLabel {
  id: string;
  code: string;
  label: string;
  expectedQuantity: number | null;
  qr: string;
}

interface LabelSheetProps {
  items: LabelItem[];
  places: PlaceLabel[];
}

/**
 * Where labels get made.
 *
 * Two lists: things that already have a code, which is the sheet you print,
 * and things that don't, which is the work left to do. Heavy or bulk stock
 * gets a place-code instead — one sticker on the shelf saying what lives
 * there and how many should be on it, because nobody is scanning forty
 * paving slabs one at a time.
 */
export function LabelSheet({ items, places }: LabelSheetProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [placeName, setPlaceName] = useState("");
  const [placeQuantity, setPlaceQuantity] = useState("");

  const labelled = items.filter((item) => item.code);
  const unlabelled = items.filter((item) => !item.code);

  function issue(input: Parameters<typeof issueCode>[0]) {
    setMessage(null);
    startTransition(async () => {
      const result = await issueCode(input);
      setFailed(!result.ok);
      setMessage(result.message ?? null);
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-4 sm:py-6">
      <div className="flex items-start justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-bold">Labels &amp; Codes</h1>
          <p className="text-sm text-muted-foreground">
            Every item in stock gets a sticker. Scanning one is how it gets taken out and put back.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => window.print()}>
          <Printer className="mr-2 h-4 w-4" />
          Print
        </Button>
      </div>

      {message && (
        <p
          className={`mt-3 rounded-lg px-3 py-2 text-sm print:hidden ${
            failed ? "bg-red-500/15 text-red-700" : "bg-emerald-500/15 text-emerald-700"
          }`}
        >
          {message}
        </p>
      )}

      {unlabelled.length > 0 && (
        <section className="mt-5 print:hidden">
          <h2 className="mb-2 text-sm font-semibold">
            No label yet ({unlabelled.length})
          </h2>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() => {
                // One at a time, in order, so a failure part-way through
                // leaves the rest of the list exactly as it was.
                const next = unlabelled[0];
                issue(next.kind === "tool" ? { toolId: next.id } : { materialId: next.id });
              }}
            >
              <QrCode className="mr-2 h-4 w-4" />
              Label the next one
            </Button>
          </div>
          <ul className="mt-2 space-y-1">
            {unlabelled.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between rounded-lg border border-white/60 bg-card/60 px-3 py-2 text-sm backdrop-blur-md"
              >
                <span className="truncate pr-2">{item.name}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    issue(item.kind === "tool" ? { toolId: item.id } : { materialId: item.id })
                  }
                >
                  Make code
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-5 print:hidden">
        <h2 className="mb-2 text-sm font-semibold">Label a storage place</h2>
        <p className="mb-2 text-sm text-muted-foreground">
          For heavy or bulk stock. The sticker goes where it lives and says how many should be
          there.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[10rem] flex-1">
            <Input
              value={placeName}
              onChange={(event) => setPlaceName(event.target.value)}
              placeholder="Bay 3 — mulch"
            />
          </div>
          <div className="w-28">
            <Input
              value={placeQuantity}
              onChange={(event) => setPlaceQuantity(event.target.value)}
              inputMode="numeric"
              placeholder="How many"
            />
          </div>
          <Button
            type="button"
            disabled={pending || !placeName.trim()}
            onClick={() =>
              issue({
                storageLocation: placeName.trim(),
                label: placeName.trim(),
                expectedQuantity: placeQuantity.trim() ? Number(placeQuantity) : null,
              })
            }
          >
            Make code
          </Button>
        </div>
      </section>

      {(labelled.length > 0 || places.length > 0) && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold print:hidden">
            Sheet ({labelled.length + places.length})
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {labelled.map((item) => (
              <Label
                key={item.id}
                qr={item.qr!}
                code={item.code!}
                name={item.name}
                sub={item.onHand != null ? `${item.onHand} ${item.unit} on hand` : item.unit}
              />
            ))}
            {places.map((place) => (
              <Label
                key={place.id}
                qr={place.qr}
                code={place.code}
                name={place.label}
                sub={
                  place.expectedQuantity != null
                    ? `Should hold ${place.expectedQuantity}`
                    : "Storage place"
                }
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Label({
  qr,
  code,
  name,
  sub,
}: {
  qr: string;
  code: string;
  name: string;
  sub: string;
}) {
  return (
    <div className="break-inside-avoid rounded-xl border border-black/20 bg-white px-3 py-3 text-center text-black">
      <div
        className="mx-auto h-28 w-28 [&>svg]:h-full [&>svg]:w-full"
        dangerouslySetInnerHTML={{ __html: qr }}
      />
      <p className="mt-1 truncate text-sm font-semibold">{name}</p>
      <p className="text-xs text-black/60">{sub}</p>
      <p className="mt-1 font-mono text-base font-bold tracking-widest">{code}</p>
    </div>
  );
}
