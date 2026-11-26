"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, Share2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { copyNow, writeClipboard } from "@/lib/clipboard";
import { startReferral } from "@/lib/actions/referral-actions";
import { AFFILIATIONS, firstNameOf, type Affiliation } from "@/lib/referral-message";
import { cn } from "@/lib/utils";

/** Which screen of the card: the button, one question each, then the message. */
export type ReferralStep = "start" | "name" | "how" | "message";

/**
 * The top of an affiliate's app: one button, then two quick questions.
 * Who it's for, and how they know them. Picking how they know them makes the
 * message straight away and copies it, so all that's left is going back to
 * the post (or text) and pasting it. Each one is tracked, so they can see how
 * far that person got.
 */
export function ReferralMessageCard({
  sample,
}: {
  sample?: { step?: ReferralStep; name?: string; affiliation?: Affiliation; message?: string; copied?: boolean };
}) {
  const router = useRouter();
  const [step, setStep] = useState<ReferralStep>(sample?.step ?? (sample?.message ? "message" : "start"));
  const [name, setName] = useState(sample?.name ?? "");
  const [affiliation, setAffiliation] = useState<Affiliation | null>(sample?.affiliation ?? null);
  const [message, setMessage] = useState<string | null>(sample?.message ?? null);
  const [copied, setCopied] = useState(sample?.copied ?? false);
  const [autoCopied, setAutoCopied] = useState(sample?.copied ?? false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  const them = firstNameOf(name) || "them";

  function go(next: ReferralStep) {
    setError(null);
    setStep(next);
  }

  /** Picking how they know them is the last answer: make the message and copy it. */
  function pick(a: Affiliation) {
    setAffiliation(a);
    setError(null);
    if (!name.trim()) return go("name");
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
        setAutoCopied(ok);
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

  async function share() {
    if (!message) return;
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ text: message });
      } catch {
        // Backing out of the share sheet is not an error.
      }
      return;
    }
    await copy();
  }

  function another() {
    setName("");
    setAffiliation(null);
    setMessage(null);
    setCopied(false);
    setAutoCopied(false);
    setError(null);
    setBusy(false);
    // Straight to who it's for: they already said they're sending another.
    setStep("name");
    topRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  if (step === "start") {
    return (
      <Button type="button" className="h-12 w-full text-base" onClick={() => go("name")}>
        Send my link to someone
      </Button>
    );
  }

  if (step === "message" && message) {
    return (
      <div ref={topRef} className="grid gap-3">
        {copied ? (
          <div className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-3">
            <p className="flex items-center gap-1 text-base font-semibold">
              <Check className="h-5 w-5" /> {autoCopied ? "Your message is copied" : "Copied"}
            </p>
            <p className="mt-1 text-sm">{pasteWhere(affiliation, them)}</p>
          </div>
        ) : (
          <Eyebrow>Copy and paste this message</Eyebrow>
        )}
        <Textarea rows={11} value={message} onChange={(e) => { setMessage(e.target.value); setCopied(false); setAutoCopied(false); }} aria-label="Your message" className="text-base leading-snug" />
        <p className="text-xs text-muted-foreground">
          Change anything so it sounds like you{copied ? ", then tap Copy again" : ""}. Keep the link as it is: that&apos;s how it counts for you.
        </p>
        <Button type="button" variant={copied ? "outline" : "default"} className="h-12 text-base" onClick={copy}>
          <Copy className="mr-1 h-5 w-5" />
          {copied ? "Copy again" : "Copy message"}
        </Button>
        <Button type="button" variant="outline" className="h-12 text-base" onClick={share}>
          <Share2 className="mr-1 h-5 w-5" /> Share
        </Button>
        <Button type="button" variant="outline" className="h-12 text-base" onClick={another}>
          Send to the next person
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div ref={topRef} className="grid gap-3">
      {step === "name" && (
        <>
          <Eyebrow>Step 1 of 2</Eyebrow>
          <label className="grid gap-2 text-base font-semibold">
            Who are you sending it to?
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) go("how");
              }}
              placeholder="Their name"
              autoComplete="off"
              autoFocus={!sample}
              className="h-12 text-base font-normal"
            />
          </label>
          <Button type="button" className="h-12 text-base" onClick={() => (name.trim() ? go("how") : setError("Type who you're sending it to."))}>
            Next
          </Button>
        </>
      )}

      {step === "how" && (
        <>
          <Eyebrow>Step 2 of 2</Eyebrow>
          <p className="text-base font-semibold">How do you know {them}?</p>
          <p className="-mt-2 text-sm text-muted-foreground">Tap one and your message is made and copied.</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={`How do you know ${them}?`}>
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
          {busy && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Making your message…
            </p>
          )}
        </>
      )}

      <div className="flex items-center justify-between">
        <button type="button" className="text-sm text-muted-foreground underline" onClick={() => go(step === "how" ? "name" : "start")}>
          Back
        </button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

/** Where to paste it, in their words: back to the post, their message, or a text. */
export function pasteWhere(affiliation: Affiliation | null, them: string): string {
  if (affiliation === "online_post") return "Now go back to the post and paste it as a comment.";
  if (affiliation === "online_message") return `Now go back to your messages with ${them} and paste it.`;
  return `Now go to your texts with ${them} and paste it.`;
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{children}</p>;
}
