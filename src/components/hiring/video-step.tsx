"use client";

import { useRef, useState, useTransition } from "react";
import { CheckCircle2, Link2, Loader2, Upload, Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { finishApplicantVideo, startApplicantVideo, submitApplicantVideoLink } from "@/lib/actions/hiring-public-actions";

/**
 * Record or choose a short video and send it. The phone uploads straight to
 * storage; a video too big for that is sent as a link instead.
 */
export function VideoStep({ token, prompt, alreadyIn, businessName }: { token: string; prompt: string; alreadyIn: boolean; businessName: string }) {
  const recordRef = useRef<HTMLInputElement>(null);
  const chooseRef = useRef<HTMLInputElement>(null);
  const [done, setDone] = useState(alreadyIn);
  const [error, setError] = useState<string | null>(null);
  const [showLink, setShowLink] = useState(false);
  const [link, setLink] = useState("");
  const [busy, start] = useTransition();

  function upload(file: File | undefined) {
    if (!file) return;
    setError(null);
    start(async () => {
      const slot = await startApplicantVideo({ token, type: file.type, size: file.size });
      if (!slot.ok) {
        if (slot.error === "too_big") {
          setError("That video is too big to upload from here. Record a shorter one (about a minute), or send it as a link below.");
          setShowLink(true);
        } else setError(slot.error);
        return;
      }
      const sent = await createClient().storage.from("applicant-videos").uploadToSignedUrl(slot.path, slot.uploadToken, file, { contentType: file.type });
      if (sent.error) {
        setError("Your video didn't upload. Check your signal and try again, or send it as a link below.");
        setShowLink(true);
        return;
      }
      const finished = await finishApplicantVideo({ token, path: slot.path });
      if (!finished.ok) return setError(finished.error);
      setDone(true);
    });
  }

  function sendLink() {
    setError(null);
    start(async () => {
      const result = await submitApplicantVideoLink({ token, link });
      if (!result.ok) return setError(result.error);
      setDone(true);
    });
  }

  if (done) {
    return (
      <section className="rounded-2xl border border-border bg-card p-5 text-center">
        <CheckCircle2 className="mx-auto h-8 w-8 text-primary" />
        <h2 className="mt-2 text-lg font-semibold">We have your video</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Someone from {businessName} will watch it and be in touch about meeting in person. Want to redo it? Send a new one below and it
          replaces this one.
        </p>
        <Button type="button" variant="outline" className="mt-3" onClick={() => setDone(false)}>
          Send a new video
        </Button>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4">
      <div>
        <h2 className="text-lg font-semibold">Record a short video</h2>
        <p className="mt-1 text-sm text-muted-foreground">About a minute is perfect. Hold your phone up, find some light, and just talk to us:</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
          <li>Who you are and where you live</li>
          <li>Why you want this job</li>
          <li>{prompt}</li>
        </ol>
      </div>

      <input ref={recordRef} type="file" accept="video/*" capture="user" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
      <input ref={chooseRef} type="file" accept="video/*" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />

      <div className="grid gap-2">
        <Button type="button" className="h-12 text-base font-semibold" disabled={busy} onClick={() => recordRef.current?.click()}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Video className="mr-2 h-5 w-5" />}
          {busy ? "Sending your video. Keep this page open" : "Record now"}
        </Button>
        <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={() => chooseRef.current?.click()}>
          <Upload className="mr-2 h-4 w-4" />
          Choose a video I already recorded
        </Button>
        <button type="button" className="mt-1 flex items-center justify-center gap-1 text-sm text-muted-foreground underline-offset-2 hover:underline" onClick={() => setShowLink((v) => !v)}>
          <Link2 className="h-4 w-4" /> Send a link instead (YouTube, Google Drive, iCloud)
        </button>
      </div>

      {showLink && (
        <div className="grid gap-2 rounded-lg border border-border bg-muted/30 p-3">
          <label className="text-sm font-medium" htmlFor="video-link">
            Link to your video
          </label>
          <Input id="video-link" inputMode="url" placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} />
          <p className="text-xs text-muted-foreground">Make sure anyone with the link can watch it.</p>
          <Button type="button" variant="secondary" disabled={busy || !link.trim()} onClick={sendLink}>
            Send link
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <p className="text-xs text-muted-foreground">Not ready? Bookmark this page and come back. Your link keeps working.</p>
    </section>
  );
}
