"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { generateClientCoi, openClientCoi, sendClientCoi } from "@/lib/actions/back-office-actions";

/** Make a certificate of insurance for this client, look at it, and email it. */
export function ClientCoiForm({ customerId, defaultHolder, cois }: { customerId: string; defaultHolder: string; cois: { id: string; holderName: string; createdAt: string; sentAt: string | null; sentTo: string | null }[] }) {
  const router = useRouter();
  const [holder, setHolder] = useState(defaultHolder);
  const [address, setAddress] = useState("");
  const [additional, setAdditional] = useState(false);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);

  const field = "h-11 w-full rounded-md border bg-background px-2 text-sm";
  return (
    <div className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          Certificate holder
          <input className={field} value={holder} onChange={(e) => setHolder(e.target.value)} />
        </label>
        <label className="grid gap-1 text-sm">
          Holder&apos;s address
          <input className={field} value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="h-5 w-5" checked={additional} onChange={(e) => setAdditional(e.target.checked)} />
          They asked to be named additional insured
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="min-h-11"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const made = await generateClientCoi({ customerId, holderName: holder, holderAddress: address, additionalInsured: additional });
              if (!made.ok) return setNote({ text: made.error, bad: true });
              const sent = await sendClientCoi(made.id);
              setNote(sent.ok ? { text: sent.message ?? "Sent.", bad: false } : { text: `Made, but not sent: ${sent.error}`, bad: true });
              router.refresh();
            })
          }
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Make and send
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const made = await generateClientCoi({ customerId, holderName: holder, holderAddress: address, additionalInsured: additional });
              if (!made.ok) return setNote({ text: made.error, bad: true });
              if (made.url) window.open(made.url, "_blank", "noopener");
              setNote({ text: "Made. Look it over, then send it from the list below.", bad: false });
              router.refresh();
            })
          }
        >
          Make only
        </Button>
      </div>
      {note && <p className={`text-sm ${note.bad ? "text-destructive" : "text-muted-foreground"}`}>{note.text}</p>}
      {cois.length > 0 && (
        <ul className="grid gap-1">
          {cois.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-sm">
              <span className="min-w-0 flex-1">
                {c.holderName} · {new Date(c.createdAt).toLocaleDateString("en-US")}
                <span className="ml-2 text-xs text-muted-foreground">{c.sentAt ? `sent to ${c.sentTo}` : "not sent"}</span>
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="min-h-11"
                onClick={async () => {
                  const r = await openClientCoi(c.id);
                  if (r.ok) window.open(r.url, "_blank", "noopener");
                  else setNote({ text: r.error, bad: true });
                }}
              >
                View
              </Button>
              {!c.sentAt && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="min-h-11"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await sendClientCoi(c.id);
                      setNote(r.ok ? { text: r.message ?? "Sent.", bad: false } : { text: r.error, bad: true });
                      router.refresh();
                    })
                  }
                >
                  Send
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
