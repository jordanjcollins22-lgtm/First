"use client";

import { useState, useTransition } from "react";
import { Check, Copy, ImagePlus, Loader2, Send } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { createShotUpload, recordRecommendation, MAX_SHOT_BYTES, SHOT_TYPES } from "@/lib/actions/recommendation-actions";
import { groupWordFor, PLATFORMS, type Platform, type PostDraft } from "@/lib/recommendations";
import { createClient } from "@/lib/supabase/client";

/**
 * Recording a reply to somebody asking for a landscaper, and getting the words back.
 *
 * The whole thing is meant to take under a minute, standing up, on a phone.
 * Somebody has just seen a post in a group and is about to answer it: the
 * screenshot is the evidence, the group is the thing worth counting, and what
 * they need back is text they can paste without editing.
 *
 * The link is made here, not chosen. Every reply gets its own code so the
 * group can be counted, and a code somebody typed themselves would be a code
 * nothing recorded.
 */
export function RecommendationForm() {
  const [platform, setPlatform] = useState<Platform>("facebook");
  const [groupName, setGroupName] = useState("");
  const [askedBy, setAskedBy] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ link: string; drafts: PostDraft[] } | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      let screenshotPath: string | null = null;

      if (file) {
        if (!SHOT_TYPES.includes(file.type)) return setError("That needs to be a PNG, a JPG or a WebP.");
        if (file.size > MAX_SHOT_BYTES) return setError("That image is too big.");
        const slot = await createShotUpload({ fileType: file.type, fileSize: file.size });
        if (!slot.ok) return setError(slot.error);
        const sent = await createClient()
          .storage.from("recommendation-shots")
          .uploadToSignedUrl(slot.path, slot.token, file, { contentType: file.type });
        if (sent.error) return setError("That image would not upload. Try a smaller one.");
        screenshotPath = slot.path;
      }

      const outcome = await recordRecommendation({ platform, groupName, askedBy, note, screenshotPath });
      if (!outcome.ok) return setError(outcome.error);
      setResult({ link: outcome.link, drafts: outcome.drafts });
    });
  }

  if (result) {
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
          <p className="text-sm font-semibold">Recorded. Here&apos;s what to paste.</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            This link is yours and belongs to this one reply, so anything that comes of it lands against
            you and against this group.
          </p>
        </div>

        {result.drafts.map((draft) => (
          <CopyBlock key={draft.tone} tone={draft.tone} text={draft.text} />
        ))}

        <CopyBlock tone="Just the link" text={result.link} />

        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setResult(null);
            setFile(null);
            setGroupName("");
            setAskedBy("");
            setNote("");
          }}
        >
          Record another
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">Where was it?</span>
        <div className="flex flex-wrap gap-1.5">
          {PLATFORMS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setPlatform(option.key)}
              className={cn(
                "min-h-9 rounded-full border px-3 text-xs",
                platform === option.key
                  ? "border-primary bg-primary/10 font-medium text-primary"
                  : "border-border text-muted-foreground hover:bg-accent"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">
          {groupWordFor(platform)}
          <span className="ml-1.5 font-normal text-muted-foreground">
            This is the bit worth counting — spell it the same way each time.
          </span>
        </span>
        <Input
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          placeholder="Bel Air Community"
          className="h-10"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">
          Who asked? <span className="font-normal text-muted-foreground">Optional, first name is plenty</span>
        </span>
        <Input value={askedBy} onChange={(e) => setAskedBy(e.target.value)} className="h-10" />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">
          Screenshot <span className="font-normal text-muted-foreground">Optional, and kept private</span>
        </span>
        <div className="flex items-center gap-2">
          <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 text-xs text-muted-foreground hover:bg-accent">
            <ImagePlus className="h-4 w-4" />
            {file ? file.name : "Choose an image"}
            <input
              type="file"
              accept={SHOT_TYPES.join(",")}
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {file && (
            <button type="button" onClick={() => setFile(null)} className="text-xs text-muted-foreground underline">
              Remove
            </button>
          )}
        </div>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">
          Anything worth knowing? <span className="font-normal text-muted-foreground">Optional</span>
        </span>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="text-sm" />
      </label>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="button" className="h-11" disabled={pending} onClick={submit}>
        {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
        {pending ? "Getting your link…" : "Get my link and wording"}
      </Button>
    </div>
  );
}

/** One block of text with a button that puts it on the clipboard. */
function CopyBlock({ tone, text }: { tone: string; text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted-foreground">{tone}</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              // A browser that refuses the clipboard still shows the text,
              // which somebody can select by hand.
            }
          }}
        >
          {copied ? <Check className="mr-1 h-3 w-3" /> : <Copy className="mr-1 h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap break-words text-sm">{text}</p>
    </div>
  );
}
