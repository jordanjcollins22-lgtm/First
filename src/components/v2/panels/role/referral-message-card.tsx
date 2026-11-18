"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ClipboardPaste, Copy, ImagePlus, Loader2, Share2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { copyNow, writeClipboard } from "@/lib/clipboard";
import { startReferral } from "@/lib/actions/referral-actions";
import { createShotUpload } from "@/lib/actions/outreach-link-actions";
import { createClient } from "@/lib/supabase/client";
import { shrinkImage } from "@/lib/shrink-image";
import { AFFILIATIONS, firstNameOf, type Affiliation } from "@/lib/referral-message";
import { cn } from "@/lib/utils";

/** Which screen of the card: the button, one question each, then the message. */
export type ReferralStep = "start" | "name" | "how" | "shot" | "message";

/**
 * The top of an affiliate's app: one button, then one question per screen.
 * Who it's for, how they know them, and a screenshot of who they're
 * answering (optional). Submit, and they get a message to copy and send with
 * their own tracked link in it. Each one is tracked, so they can see how far
 * that person got.
 */
export function ReferralMessageCard({
  sample,
}: {
  sample?: { step?: ReferralStep; name?: string; affiliation?: Affiliation; message?: string; shotName?: string };
}) {
  const router = useRouter();
  const [step, setStep] = useState<ReferralStep>(sample?.step ?? (sample?.message ? "message" : "start"));
  const [name, setName] = useState(sample?.name ?? "");
  const [affiliation, setAffiliation] = useState<Affiliation | null>(sample?.affiliation ?? null);
  const [message, setMessage] = useState<string | null>(sample?.message ?? null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shot, setShot] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const shotName = shot?.name ?? sample?.shotName ?? null;
  const them = firstNameOf(name) || "them";

  // On the screenshot step, a pasted image (Ctrl+V, or Paste from the phone's menu) becomes the screenshot.
  useEffect(() => {
    if (step !== "shot") return;
    const onPaste = (e: ClipboardEvent) => {
      const file = imageFrom(e.clipboardData);
      if (!file) return;
      e.preventDefault();
      setError(null);
      setShot(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [step]);

  async function pasteShot() {
    setError(null);
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (!type) continue;
        const blob = await item.getType(type);
        return setShot(new File([blob], `pasted-screenshot.${type.split("/")[1] || "png"}`, { type }));
      }
      setError("There's no picture copied. Copy the screenshot first, then tap Paste.");
    } catch {
      setError("Your phone didn't allow pasting here. Press and hold the box below, then tap Paste.");
    }
  }

  function go(next: ReferralStep) {
    setError(null);
    setStep(next);
  }

  function submit() {
    setError(null);
    if (!name.trim()) return go("name");
    if (!affiliation) return go("how");
    if (busy) return;
    setBusy(true);
    // Not inside a transition: the next one has to be startable straight away,
    // without waiting on the page to reload its lists.
    void (async () => {
      try {
        let screenshotPath: string | null = null;
        if (shot) {
          const small = await shrinkImage(shot).catch(() => shot);
          const slot = await createShotUpload({ fileType: small.type, fileSize: small.size });
          if (!slot.ok) return setError(slot.error);
          const sent = await createClient().storage.from("recommendation-shots").uploadToSignedUrl(slot.path, slot.token, small, { contentType: small.type });
          if (sent.error) return setError("That screenshot wouldn't upload. Try a smaller one, or leave it off.");
          screenshotPath = slot.path;
        }
        const r = await startReferral({ name, affiliation, screenshotPath });
        if (!r.ok) return setError(r.error);
        setMessage(r.message);
        setStep("message");
        router.refresh();
      } catch {
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
    setShot(null);
    if (fileRef.current) fileRef.current.value = "";
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
        <Eyebrow>Copy and paste this message</Eyebrow>
        <Textarea rows={13} value={message} onChange={(e) => setMessage(e.target.value)} aria-label="Your message" className="text-base leading-snug" />
        <p className="text-xs text-muted-foreground">Change anything so it sounds like you. Keep the link as it is: that&apos;s how it counts for you.</p>
        <Button type="button" className="h-12 text-base" onClick={copy}>
          {copied ? <Check className="mr-1 h-5 w-5" /> : <Copy className="mr-1 h-5 w-5" />}
          {copied ? "Copied" : "Copy message"}
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
          <Eyebrow>Step 1 of 3</Eyebrow>
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
          <Eyebrow>Step 2 of 3</Eyebrow>
          <p className="text-base font-semibold">How do you know {them}?</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={`How do you know ${them}?`}>
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
          <Button type="button" className="h-12 text-base" onClick={() => (affiliation ? go("shot") : setError("Pick how you know them."))}>
            Next
          </Button>
        </>
      )}

      {step === "shot" && (
        <>
          <Eyebrow>Step 3 of 3</Eyebrow>
          <p className="text-base font-semibold">Add a screenshot of who you&apos;re answering</p>
          <p className="-mt-2 text-sm text-muted-foreground">Optional. A post or text from them, so we can see who you sent it to. Paste it or upload it.</p>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => setShot(e.target.files?.[0] ?? null)}
          />
          {shotName ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
              <span className="min-w-0 truncate">{shotName}</span>
              <button
                type="button"
                aria-label="Remove the screenshot"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setShot(null);
                  if (fileRef.current) fileRef.current.value = "";
                }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" className="h-11" onClick={pasteShot}>
                  <ClipboardPaste className="mr-1 h-5 w-5" /> Paste
                </Button>
                <Button type="button" variant="outline" className="h-11" onClick={() => fileRef.current?.click()}>
                  <ImagePlus className="mr-1 h-5 w-5" /> Upload
                </Button>
              </div>
              <textarea
                aria-label="Paste a screenshot here"
                rows={1}
                value=""
                onChange={() => undefined}
                placeholder="Or press and hold here, then Paste"
                className="w-full resize-none rounded-lg border border-dashed bg-background px-3 py-2 text-center text-sm text-muted-foreground"
              />
            </>
          )}
          <Button type="button" className="h-12 text-base" disabled={busy} onClick={submit}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Submit
          </Button>
        </>
      )}

      <div className="flex items-center justify-between">
        <button type="button" className="text-sm text-muted-foreground underline" onClick={() => go(step === "shot" ? "how" : step === "how" ? "name" : "start")}>
          Back
        </button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

/** The first picture in a paste, if there is one. */
function imageFrom(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const item of Array.from(data.items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file.name && file.name !== "image.png" ? file : new File([file], `pasted-screenshot.${item.type.split("/")[1] || "png"}`, { type: item.type });
    }
  }
  return null;
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{children}</p>;
}
