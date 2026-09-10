"use client";

import { useState, useTransition } from "react";
import { ImagePlus, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { createShotUpload } from "@/lib/actions/recommendation-actions";
import { MAX_SHOT_BYTES, SHOT_TYPES } from "@/lib/recommendations";
import { POST_KINDS, URGENCIES, type PostKind, type Urgency } from "@/lib/community-groups";
import {
  recordGroupPost,
  triagePost,
  type TriageReading,
} from "@/lib/actions/community-group-actions";
import type { GroupRow } from "@/lib/data/community-groups";

/**
 * Dropping a post in and finding out what it is.
 *
 * Facebook will not hand a group's feed to any app — the Groups API was
 * discontinued in April 2024 — so a post gets in here the only way left: a
 * person pastes the words or photographs the screen. That is the cost of the
 * whole feature, and it is why this takes fifteen seconds rather than none.
 *
 * The reading is shown as filled-in boxes rather than a verdict. A person is
 * about to answer a neighbour or refuse a business on the strength of it, and
 * both of those are worse done confidently than done slowly.
 */
export function PostTriage({ groups, services }: { groups: GroupRow[]; services: string[] }) {
  const live = groups.filter((group) => !group.archivedAt);
  const [groupId, setGroupId] = useState(live[0]?.id ?? "");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [reading, setReading] = useState<TriageReading | null>(null);
  const [shotPath, setShotPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  // The reading, once a person has had a chance to disagree with it.
  const [kind, setKind] = useState<PostKind>("request");
  const [service, setService] = useState("");
  const [urgency, setUrgency] = useState<Urgency | "">("");
  const [author, setAuthor] = useState("");
  const [summary, setSummary] = useState("");

  if (live.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Make a group first, then posts from it can be sorted here.
      </p>
    );
  }

  function read() {
    setError(null);
    setSaved(false);
    start(async () => {
      let path = shotPath;
      if (file && !path) {
        if (!SHOT_TYPES.includes(file.type)) return setError("That needs to be a PNG, a JPG or a WebP.");
        if (file.size > MAX_SHOT_BYTES) return setError("That image is too big.");
        const slot = await createShotUpload({ fileType: file.type, fileSize: file.size });
        if (!slot.ok) return setError(slot.error);
        const sent = await createClient()
          .storage.from("recommendation-shots")
          .uploadToSignedUrl(slot.path, slot.token, file, { contentType: file.type });
        if (sent.error) return setError("That image would not upload. Try a smaller one.");
        path = slot.path;
        setShotPath(path);
      }

      const result = await triagePost({ groupId, pastedText: text, screenshotPath: path, note });
      if (!result.ok) return setError(result.error);

      setReading(result.value);
      setKind(result.value.kind);
      setService(result.value.service ?? "");
      setUrgency(result.value.urgency ?? "");
      setAuthor(result.value.author ?? "");
      setSummary(result.value.summary);
    });
  }

  function save() {
    setError(null);
    start(async () => {
      const result = await recordGroupPost({
        groupId,
        kind,
        service,
        urgency,
        authorName: author,
        summary,
        matchedWords: reading?.matchedWords ?? [],
        postedText: text,
        screenshotPath: shotPath,
      });
      if (!result.ok) return setError(result.error);
      setSaved(true);
      setReading(null);
      setText("");
      setNote("");
      setFile(null);
      setShotPath(null);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {live.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {live.map((group) => (
            <button
              key={group.id}
              type="button"
              onClick={() => setGroupId(group.id)}
              className={cn(
                "min-h-9 rounded-full border px-3 text-xs",
                groupId === group.id
                  ? "border-primary bg-primary/10 font-medium text-primary"
                  : "border-border text-muted-foreground hover:bg-accent"
              )}
            >
              {group.name}
            </button>
          ))}
        </div>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">
          The post{" "}
          <span className="font-normal text-muted-foreground">
            Paste the words, or add a screenshot, or both.
          </span>
        </span>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          className="text-sm"
          placeholder="Does anyone know someone who could clear the leaves out of my back yard before the weekend?"
        />
      </label>

      <div className="flex items-center gap-2">
        <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 text-xs text-muted-foreground hover:bg-accent">
          <ImagePlus className="h-4 w-4" />
          {file ? file.name : "Screenshot (optional)"}
          <input
            type="file"
            accept={SHOT_TYPES.join(",")}
            className="hidden"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setShotPath(null);
            }}
          />
        </label>
        {file && (
          <button
            type="button"
            onClick={() => {
              setFile(null);
              setShotPath(null);
            }}
            className="text-xs text-muted-foreground underline"
          >
            Remove
          </button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && <p className="text-sm text-primary">Filed.</p>}

      {!reading && (
        <Button type="button" onClick={read} disabled={pending || !groupId}>
          {pending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Reading it…
            </>
          ) : (
            "Read it"
          )}
        </Button>
      )}

      {reading && (
        <div className="flex flex-col gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
          <p className="text-xs text-muted-foreground">
            {reading.readByModel
              ? "Read from the post. Change anything that is wrong before filing it."
              : "Sorted on keywords only, so check it. The reader needs an Anthropic key to do better."}
          </p>

          <div className="flex flex-wrap gap-1.5">
            {POST_KINDS.map((option) => (
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
          <p className="-mt-1 text-xs text-muted-foreground">
            {POST_KINDS.find((option) => option.key === kind)?.blurb}
          </p>

          {kind === "request" && (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium">What they want done</span>
                <select
                  value={service}
                  onChange={(e) => setService(e.target.value)}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Not sure yet</option>
                  {services.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex flex-wrap gap-1.5">
                {URGENCIES.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setUrgency(urgency === option.key ? "" : option.key)}
                    className={cn(
                      "min-h-9 rounded-full border px-3 text-xs",
                      urgency === option.key
                        ? "border-primary bg-primary/10 font-medium text-primary"
                        : "border-border text-muted-foreground hover:bg-accent"
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </>
          )}

          {kind === "promotion" && reading.matchedWords.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Caught on: {reading.matchedWords.join(", ")}
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">Who posted</span>
              <Input value={author} onChange={(e) => setAuthor(e.target.value)} className="h-10" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">In a line</span>
              <Input value={summary} onChange={(e) => setSummary(e.target.value)} className="h-10" />
            </label>
          </div>

          <div className="flex gap-2">
            <Button type="button" onClick={save} disabled={pending}>
              {pending ? "Filing…" : "File it"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setReading(null)} disabled={pending}>
              Back
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
