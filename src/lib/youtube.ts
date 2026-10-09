const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Pulls the 11-character video ID out of anything a user might paste:
 * a bare ID, youtube.com/watch?v=, youtu.be/, /shorts/, /embed/ or /live/ links.
 */
export function parseYouTubeId(input: string): string | null {
  const value = input.trim();
  if (VIDEO_ID.test(value)) return value;

  let url: URL;
  try {
    url = new URL(value.includes("://") ? value : `https://${value}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, "");
  let id: string | null = null;

  if (host === "youtu.be") {
    id = url.pathname.split("/")[1] ?? null;
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const [, first, second] = url.pathname.split("/");
    if (first === "watch") id = url.searchParams.get("v");
    else if (["embed", "shorts", "live", "v"].includes(first)) id = second ?? null;
  }

  return id && VIDEO_ID.test(id) ? id : null;
}

/** Privacy-enhanced embed URL (no tracking cookies until the viewer presses play). */
export function youTubeEmbedUrl(id: string, autoplay = false): string {
  const params = new URLSearchParams({ rel: "0", modestbranding: "1", playsinline: "1" });
  if (autoplay) params.set("autoplay", "1");
  return `https://www.youtube-nocookie.com/embed/${id}?${params}`;
}
