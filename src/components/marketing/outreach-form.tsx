"use client";

import { useRef, useState, useTransition } from "react";
import { Check, Copy, ImagePlus, Loader2, Send } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  createShotUpload,
  draftCommentFromScreenshot,
  readRecommendationScreenshot,
  recordOutreach,
} from "@/lib/actions/outreach-link-actions";
import {
  goesToOnePerson,
  groupWordFor,
  MAX_SHOT_BYTES,
  OUTREACH_KINDS,
  PLATFORMS,
  SHOT_TYPES,
  type OutreachKind,
  type Platform,
  type PostDraft,
} from "@/lib/outreach-links";
import { createClient } from "@/lib/supabase/client";

/**
 * Recording a reply to somebody asking for a landscaper, and getting the words back.
 *
 * The whole thing is meant to take under a minute, standing up, on a phone.
 * Somebody has just seen a post in a group and is about to answer it: the
 * screenshot is the evidence, the group is the thing worth counting, and what
 * they need back is text they can paste without editing.
 *
 * So the screenshot comes first and everything else fills itself in. Asking
 * somebody to type the platform, the group, the name and what they want is
 * four fields they skip or get wrong, and a group name spelled two ways is two
 * groups in the tally. All four are already in the picture. The reading is
 * editable afterwards, because the person who was there is the one who knows,
 * but they correct a filled box instead of composing an empty one.
 *
 * The link is made here, not chosen. Every reply gets its own code so the
 * group can be counted, and a code somebody typed themselves would be a code
 * nothing recorded.
 */
export function OutreachForm() {
  const [kind, setKind] = useState<OutreachKind>("comment");
  const [platform, setPlatform] = useState<Platform>("facebook");
  const [groupName, setGroupName] = useState("");
  const [fromPage, setFromPage] = useState("");
  const [askedBy, setAskedBy] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  // Uploaded once, the moment a picture is chosen, and reused when the record
  // is written. Uploading twice would mean two copies of the same evidence.
  const [shotPath, setShotPath] = useState<string | null>(null);
  // How old the post is, off the screenshot. Nothing shows it; it decides
  // which opener the comment gets.
  const [ageDays, setAgeDays] = useState<number | null>(null);
  // What the last reading put in each box.
  //
  // A second screenshot has to be able to replace its own earlier answers,
  // or picking the right picture after the wrong one leaves the wrong group
  // in the field that everything is counted by. Anything a person typed is
  // theirs and survives. A ref rather than state: it is read inside an async
  // handler that would otherwise close over a stale copy.
  const filled = useRef({ groupName: "", askedBy: "", note: "" });
  const [readNote, setReadNote] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ link: string; drafts: PostDraft[] } | null>(null);
  // Written from the screenshot, and the reason to upload one. Null while it
  // is being written, and stays null when there was no picture to read.
  const [comment, setComment] = useState<string | null>(null);
  const [commentNote, setCommentNote] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [pending, startTransition] = useTransition();

  /**
   * Take the picture in and read it, without waiting to be asked.
   *
   * Uploading and reading start the moment a file is chosen rather than on a
   * second button, because the second button is the one nobody presses. It
   * takes a couple of seconds, and the rest of the form is usable throughout —
   * somebody who types faster than the model reads simply keeps what they
   * typed.
   */
  function pick(chosen: File | null) {
    setFile(chosen);
    setShotPath(null);
    setAgeDays(null);
    setReadNote(null);
    setError(null);
    if (!chosen) return;

    if (!SHOT_TYPES.includes(chosen.type)) return setError("That needs to be a PNG, a JPG or a WebP.");
    if (chosen.size > MAX_SHOT_BYTES) return setError("That image is too big.");

    setReading(true);
    void (async () => {
      try {
        const slot = await createShotUpload({ fileType: chosen.type, fileSize: chosen.size });
        if (!slot.ok) {
          setError(slot.error);
          return;
        }
        const sent = await createClient()
          .storage.from("recommendation-shots")
          .uploadToSignedUrl(slot.path, slot.token, chosen, { contentType: chosen.type });
        if (sent.error) {
          setError("That image would not upload. Try a smaller one.");
          return;
        }
        setShotPath(slot.path);

        const read = await readRecommendationScreenshot({ screenshotPath: slot.path });
        if (!read.ok) {
          setReadNote(read.error);
          return;
        }

        // Fills a box that is empty, or one this reader filled last time.
        // Somebody who typed the group name while it was reading meant that
        // one, and it is left alone.
        const mine = filled.current;
        const take = (current: string, previous: string, next: string) =>
          current.trim() === "" || current === previous ? next : current;

        if (read.platform) setPlatform(read.platform);
        const groupNext = read.groupName ?? "";
        const askedNext = read.askedBy ?? "";
        setGroupName((current) => take(current, mine.groupName, groupNext));
        setAskedBy((current) => take(current, mine.askedBy, askedNext));
        setNote((current) => take(current, mine.note, read.note));
        filled.current = { groupName: groupNext, askedBy: askedNext, note: read.note };
        setAgeDays(read.ageDays);
        // Named outright when a box came back empty, because "it filled
        // everything in" and "it filled two of three in" look identical on a
        // screen and only one of them needs somebody to finish the job.
        const blank = [
          groupNext ? null : "the group",
          askedNext ? null : "who asked",
          read.note.trim() ? null : "what they want",
        ].filter((word): word is string => word != null);

        setReadNote(
          !read.worthAnswering
            ? "Read it, but this looks like an advert rather than somebody asking for work."
            : blank.length === 0
              ? "Read from the screenshot. Change anything that is wrong."
              : `Read from the screenshot. It couldn't find ${listOf(blank)} — fill that in.`
        );
      } finally {
        setReading(false);
      }
    })();
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      let screenshotPath = shotPath;

      // Only when the picture never made it up — a failed upload, or a file
      // chosen while the page was offline.
      if (file && !screenshotPath) {
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

      const outcome = await recordOutreach({
        kind,
        platform,
        audience: groupName,
        fromPage,
        sentTo: askedBy,
        service: "",
        note,
        screenshotPath,
      });
      if (!outcome.ok) return setError(outcome.error);
      setResult({ link: outcome.link, drafts: outcome.drafts });

      // The written-by-hand wordings are already on screen, so this can take
      // its time. Somebody with no screenshot simply uses those.
      if (screenshotPath) {
        setWriting(true);
        const written = await draftCommentFromScreenshot({
          screenshotPath,
          link: outcome.link,
          groupName,
          note,
          ageDays,
        });
        setWriting(false);
        if (written.ok) setComment(written.comment);
        else setCommentNote(written.error);
      }
    });
  }

  if (result) {
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
          <p className="text-sm font-semibold">Recorded. Here&apos;s what to paste.</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            This link is yours and belongs to this one post. Every open is counted against it, so you
            find out whether the room even clicks, not just whether anybody booked.
          </p>
        </div>

        {writing && (
          <div className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Reading the post and writing a comment for it…
          </div>
        )}

        {comment && <CopyBlock tone="Written for this post" text={comment} highlight />}
        {commentNote && <p className="text-xs text-muted-foreground">{commentNote}</p>}

        {(comment || commentNote || !writing) && (
          <p className="text-xs font-medium text-muted-foreground">
            {comment ? "Or one of these:" : "Ready to paste:"}
          </p>
        )}

        {result.drafts.map((draft) => (
          <CopyBlock key={draft.tone} tone={draft.tone} text={draft.text} />
        ))}

        <CopyBlock tone="Just the link" text={result.link} />

        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setResult(null);
            setComment(null);
            setCommentNote(null);
            setFile(null);
            setShotPath(null);
            setAgeDays(null);
            setReadNote(null);
            setGroupName("");
            setAskedBy("");
            setNote("");
            filled.current = { groupName: "", askedBy: "", note: "" };
          }}
        >
          Record another
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">
          Screenshot of the post{" "}
          <span className="font-normal text-muted-foreground">
            Everything below fills itself in, and the comment gets written for this exact post. Kept
            private.
          </span>
        </span>
        <div className="flex items-center gap-2">
          <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 text-xs text-muted-foreground hover:bg-accent">
            <ImagePlus className="h-4 w-4" />
            {file ? file.name : "Choose an image"}
            <input
              type="file"
              accept={SHOT_TYPES.join(",")}
              className="hidden"
              onChange={(e) => pick(e.target.files?.[0] ?? null)}
            />
          </label>
          {file && (
            <button type="button" onClick={() => pick(null)} className="text-xs text-muted-foreground underline">
              Remove
            </button>
          )}
        </div>
      </label>

      {reading && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Reading the post…
        </p>
      )}
      {!reading && readNote && <p className="text-xs text-muted-foreground">{readNote}</p>}

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">What carried the link?</span>
        <div className="flex flex-wrap gap-1.5">
          {OUTREACH_KINDS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setKind(option.key)}
              className={cn(
                "min-h-9 rounded-full border px-3 text-xs",
                kind === option.key
                  ? "border-primary bg-primary/10 font-medium text-primary"
                  : "border-border text-muted-foreground hover:bg-accent"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

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
            Read off the screenshot. This is the bit worth counting, so check the spelling.
          </span>
        </span>
        <Input
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          placeholder="Bel Air Community"
          className="h-10"
        />
      </label>

      {!goesToOnePerson(kind) && (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">
            Posted from{" "}
            <span className="font-normal text-muted-foreground">
              Which of our pages or accounts. Worth counting once posts go out on a schedule.
            </span>
          </span>
          <Input
            value={fromPage}
            onChange={(e) => setFromPage(e.target.value)}
            placeholder="JS Landscaping MD page"
            className="h-10"
          />
        </label>
      )}

      {goesToOnePerson(kind) && (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">
            Who was it sent to?{" "}
            <span className="font-normal text-muted-foreground">First name is plenty</span>
          </span>
          <Input value={askedBy} onChange={(e) => setAskedBy(e.target.value)} className="h-10" />
        </label>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">
          What they want <span className="font-normal text-muted-foreground">Read from the post</span>
        </span>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="text-sm" />
      </label>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Held while the picture is being read, so a fast finger cannot record
          the reply before the boxes are filled -- or upload the screenshot a
          second time because the first one had not landed yet. */}
      <Button type="button" className="h-11" disabled={pending || reading} onClick={submit}>
        {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
        {pending ? "Getting your link…" : reading ? "Reading the post…" : "Get my link and wording"}
      </Button>
    </div>
  );
}

/** One block of text with a button that puts it on the clipboard. */
function CopyBlock({ tone, text, highlight }: { tone: string; text: string; highlight?: boolean }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className={cn("rounded-lg border p-3", highlight ? "border-primary/50 bg-primary/5" : "border-border")}>
      <div className="flex items-center justify-between gap-2">
        <p className={cn("text-xs font-semibold", highlight ? "text-primary" : "text-muted-foreground")}>{tone}</p>
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

/** "the group and who asked", the way somebody would say it. */
function listOf(words: string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}
