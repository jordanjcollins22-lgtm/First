"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseYouTubeId, youTubeEmbedUrl } from "@/lib/youtube";

export function YouTubePlayer() {
  const [url, setUrl] = useState("");
  const [videoId, setVideoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const id = parseYouTubeId(url);
    if (!id) {
      setError("That doesn't look like a YouTube link. Paste a youtube.com or youtu.be URL.");
      return;
    }
    setError(null);
    setVideoId(id);
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="text"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a YouTube link, e.g. https://youtu.be/…"
          aria-label="YouTube link"
        />
        <Button type="submit" className="sm:w-28">
          Play
        </Button>
      </form>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {videoId ? (
        <div className="aspect-video w-full overflow-hidden rounded-lg border border-border bg-black">
          <iframe
            key={videoId}
            src={youTubeEmbedUrl(videoId, true)}
            title="YouTube video player"
            className="h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
      ) : (
        <div className="flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
          Your video will play here.
        </div>
      )}
    </div>
  );
}
