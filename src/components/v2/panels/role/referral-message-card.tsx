"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, Share2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { copyNow, writeClipboard } from "@/lib/clipboard";
import { startReferral } from "@/lib/actions/referral-actions";
import { AFFILIATIONS, type Affiliation } from "@/lib/referral-message";
import { cn } from "@/lib/utils";

/**
 * The top of an affiliate's app: say who you're sending your link to and how
 * you know them, and get a message ready to copy and send, with your own
 * link in it. Each one is tracked, so you can see whether they opened it.
 */
export function ReferralMessageCard({ sample }: { sample?: { name: string; affiliation: Affiliation; message?: string } }) {
  const router = useRouter();
  const [name, setName] = useState(sample?.name ?? "");
  const [affiliation, setAffiliation] = useState<Affiliation | null>(sample?.affiliation ?? null);
  const [message, setMessage] = useState<string | null>(sample?.message ?? null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function write() {
    setError(null);
    if (!name.trim()) return setError("Type who you're sending it to.");
    if (!affiliation) return setError("Pick how you know them.");
    start(async () => {
      const r = await startReferral({ name, affiliation });
      if (!r.ok) return setError(r.error);
      setMessage(r.message);
      router.refresh();
    });
  }

  async function copy() {
    if (!message) return;
    setError(null);
    const ok = copyNow(message) || (await writeClipboard(message));
    if (!ok) return setError("Couldn't copy. Press and hold the message to copy it.");
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
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
    setError(null);
  }

  if (message) {
    return (
      <div className="grid gap-3">
        <p className="text-sm font-medium">Your message to {name.trim() || "them"}. Change anything so it sounds like you.</p>
        <Textarea rows={8} value={message} onChange={(e) => setMessage(e.target.value)} aria-label="Your message" className="text-base" />
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" className="h-12 text-base" onClick={copy}>
            {copied ? <Check className="mr-1 h-5 w-5" /> : <Copy className="mr-1 h-5 w-5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button type="button" variant="outline" className="h-12 text-base" onClick={share}>
            <Share2 className="mr-1 h-5 w-5" /> Share
          </Button>
        </div>
        <Button type="button" variant="ghost" onClick={another}>
          Send to someone else
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <label className="grid gap-1 text-sm font-medium">
        Who are you sending it to?
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Their name" autoComplete="off" className="h-12 text-base" />
      </label>
      <div className="grid gap-1">
        <p className="text-sm font-medium">How do you know them?</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="How do you know them?">
          {AFFILIATIONS.map((a) => (
            <button
              key={a.key}
              type="button"
              role="radio"
              aria-checked={affiliation === a.key}
              onClick={() => setAffiliation(a.key)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm",
                affiliation === a.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"
              )}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
      <Button type="button" className="h-12 text-base" disabled={busy} onClick={write}>
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Get my message
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
