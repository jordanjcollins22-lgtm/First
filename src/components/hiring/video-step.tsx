"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { RecordAndSend } from "@/components/hiring/record-and-send";

/**
 * The short video, recorded live in the page by tapping Record. No uploads
 * from the camera roll and no links: what we watch was recorded here.
 */
export function VideoStep({
  token,
  prompt,
  alreadyIn,
  businessName,
  remote = false,
}: {
  token: string;
  prompt: string;
  alreadyIn: boolean;
  businessName: string;
  /** Interviews for this job are calls, not in person. */
  remote?: boolean;
}) {
  const [done, setDone] = useState(alreadyIn);

  if (done) {
    return (
      <section className="rounded-2xl border border-border bg-card p-5 text-center">
        <CheckCircle2 className="mx-auto h-8 w-8 text-primary" />
        <h2 className="mt-2 text-lg font-semibold">We have your video</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Someone from {businessName} will watch it and be in touch about
          {remote ? " a phone or video interview" : " meeting in person"}. Want to redo it? Record a new one and it
          replaces this one.
        </p>
        <Button type="button" variant="outline" className="mt-3" onClick={() => setDone(false)}>
          Record a new video
        </Button>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4">
      <div>
        <h2 className="text-lg font-semibold">Record a short video</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          About a minute is perfect. Tap Record, hold your phone up, find some light, and just talk to us:
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
          <li>Who you are and where you live</li>
          <li>Why you want this job</li>
          <li>{prompt}</li>
        </ol>
      </div>

      <RecordAndSend token={token} purpose="intro" label="Record now" onSent={() => setDone(true)} />

      <p className="text-xs text-muted-foreground">Not ready? Bookmark this page and come back. Your link keeps working.</p>
    </section>
  );
}
