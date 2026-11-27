"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { copyNow, writeClipboard } from "@/lib/clipboard";
import { startReferral } from "@/lib/actions/referral-actions";
import { AFFILIATIONS, firstNameOf, type Affiliation } from "@/lib/referral-message";
import { cn } from "@/lib/utils";

/** Which screen of the card: the button, one question each, then the message. */
export type ReferralStep = "form" | "message";

/**
 * The top of an affiliate's app: who it's for, and how they know them, on
 * one screen. Tapping how they know them makes the message and copies it,
 * so all that's left is going back to the post (or text) and pasting it. Each one is tracked, so they can see how
 * far that person got.
 */
export function ReferralMessageCard({
  sample,
}: {
  sample?: { step?: ReferralStep; name?: string; affiliation?: Affiliation; message?: string; copied?: boolean };
}) {
  const router = useRouter();
  const [step, setStep] = useState<ReferralStep>(sample?.step ?? (sample?.message ? "message" : "form"));
  const [name, setName] = useState(sample?.name ?? "");
  const [affiliation, setAffiliation] = useState<Affiliation | null>(sample?.affiliation ?? null);
  const [message, setMessage] = useState<string | null>(sample?.message ?? null);
  const [copied, setCopied] = useState(sample?.copied ?? false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  const them = firstNameOf(name) || "them";

  /** Picking how they know them is the last answer: make the message and copy it. */
  function pick(a: Affiliation) {
    setAffiliation(a);
    setError(null);
    if (!name.trim()) return setError("Type who it\u2019s for first.");
    if (busy) return;
    setBusy(true);

    // The copy has to start inside the tap, or phones refuse it. A clipboard
    // item can wait on the message, so it's started now and filled when it lands.
    let resolveText: (text: string) => void = () => undefined;
    let rejectText: () => void = () => undefined;
    const text = new Promise<string>((res, rej) => {
      resolveText = res;
      rejectText = rej;
    });
    let copying: Promise<boolean> | null = null;
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        const blob = text.then((t) => new Blob([t], { type: "text/plain" }));
        copying = navigator.clipboard
          .write([new ClipboardItem({ "text/plain": blob })])
          .then(() => true)
          .catch(() => false);
      }
    } catch {
      copying = null;
    }

    void (async () => {
      try {
        const r = await startReferral({ name, affiliation: a, screenshotPath: null });
        if (!r.ok) {
          rejectText();
          return setError(r.error);
        }
        resolveText(r.message);
        let ok = copying ? await copying : false;
        if (!ok) ok = await writeClipboard(r.message);
        setMessage(r.message);
        setCopied(ok);
        setStep("message");
        router.refresh();
      } catch {
        rejectText();
        setError("Couldn't make your link just now. Try again.");
      } finally {
        setBusy(false);
      }
    })();
  }

  async function copy() {
    if (!message) return;
    setError(null);
    const ok = copyNow(message) || (await writeClipboard(message));
    if (!ok) return setError("Couldn't copy. Press and hold the message to copy it.");
    setCopied(true);
  }

  function another() {
    setName("");
    setAffiliation(null);
    setMessage(null);
    setCopied(false);
    setError(null);
    setBusy(false);
    setStep("form");
    topRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  if (step === "message" && message) {
    return (
      <div ref={topRef} className="grid gap-3">
        {copied && (
          <p className="flex items-center gap-1 text-base font-semibold">
            <Check className="h-5 w-5 text-primary" /> Copied. {pasteWhere(affiliation, them)}
          </p>
        )}
        <Textarea rows={6} value={message} onChange={(e) => { setMessage(e.target.value); setCopied(false); }} aria-label="Your message" className="text-base leading-snug" />
        <Button type="button" variant={copied ? "outline" : "default"} className="h-12 text-base" onClick={copy}>
          <Copy className="mr-1 h-5 w-5" />
          {copied ? "Copy again" : "Copy message"}
        </Button>
        <button type="button" className="text-sm text-muted-foreground underline" onClick={another}>
          Send to someone else
        </button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div ref={topRef} className="grid gap-3">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Who's it for?"
        aria-label="Who's it for?"
        autoComplete="off"
        className="h-12 text-base"
      />
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="How do you know them?">
        {AFFILIATIONS.map((a) => (
          <button
            key={a.key}
            type="button"
            role="radio"
            aria-checked={affiliation === a.key}
            disabled={busy}
            onClick={() => pick(a.key)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm disabled:opacity-60",
              affiliation === a.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"
            )}
          >
            {a.label}
          </button>
        ))}
      </div>
      {busy && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Making your message" />}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

/** Where to paste it, in their words: back to the post, their message, or a text. */
export function pasteWhere(affiliation: Affiliation | null, them: string): string {
  if (affiliation === "online_post") return "Go back to the post and paste it as a comment.";
  if (affiliation === "online_message") return `Go back to your messages with ${them} and paste it.`;
  return `Paste it in a text to ${them}.`;
}
