"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, FileAudio, Loader2 } from "lucide-react";

import { getAttachmentUrl } from "@/lib/actions/team-channel-actions";
import type { TeamMessage } from "@/types/domain";

/** Renders one message's attachment. The bucket is private, so the URL is
 * signed on demand — storage re-checks group membership when it's minted. */
export function MessageAttachment({ message }: { message: TeamMessage }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  const path = message.attachment_path;

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    (async () => {
      const signed = await getAttachmentUrl(path);
      if (cancelled) return;
      if (!signed) setFailed(true);
      else setUrl(signed);
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!path || !message.attachment_kind) return null;

  if (failed) {
    return <p className="text-xs text-muted-foreground">Couldn&apos;t load that attachment.</p>;
  }

  if (!url) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading...
      </div>
    );
  }

  if (message.attachment_kind === "image") {
    return (
      <a href={url} target="_blank" rel="noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={message.attachment_name ?? "Photo"}
          className="max-h-64 rounded-lg border border-border object-cover"
        />
      </a>
    );
  }

  if (message.attachment_kind === "video") {
    return <video src={url} controls className="max-h-64 rounded-lg border border-border" />;
  }

  // Voice memo: the recording, plus its transcript behind a toggle so a long
  // one doesn't swamp the thread.
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <FileAudio className="h-4 w-4 shrink-0 text-muted-foreground" />
        <audio src={url} controls className="h-9 max-w-full" />
      </div>
      {message.transcript ? (
        <>
          <button
            type="button"
            onClick={() => setShowTranscript((v) => !v)}
            className="flex items-center gap-1 self-start text-[10px] font-medium text-primary hover:underline"
          >
            {showTranscript ? "Hide transcript" : "Show transcript"}
            {showTranscript ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {showTranscript && (
            <p className="whitespace-pre-wrap rounded-md bg-background/60 p-2 text-xs">{message.transcript}</p>
          )}
        </>
      ) : (
        <p className="text-[10px] text-muted-foreground">Transcribing...</p>
      )}
    </div>
  );
}
