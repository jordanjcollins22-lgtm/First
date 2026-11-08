import { pickTrack, textFromJson3, textFromXml, type CaptionTrack } from "@/lib/video-notes";

/**
 * A YouTube video's title and transcript, from its captions.
 *
 * Asks YouTube's own player for the caption tracks the way its Android app
 * does, and falls back to the watch page. Either way the captions are the
 * same file people see under "Show transcript". Server only. Never throws.
 */

export type Transcript = { ok: true; title: string; author: string; seconds: number; text: string } | { ok: false; error: string };

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

interface PlayerResponse {
  videoDetails?: { title?: string; author?: string; lengthSeconds?: string };
  playabilityStatus?: { status?: string; reason?: string };
  captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
}

/** What each step saw, for the preview check. */
export const trace: string[] = [];

async function fromPlayer(id: string): Promise<PlayerResponse | null> {
  try {
    const r = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip" },
      body: JSON.stringify({ videoId: id, context: { client: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 34, hl: "en", gl: "US" } } }),
      cache: "no-store",
    });
    trace.push(`player ${r.status}`);
    if (!r.ok) return null;
    const j = (await r.json()) as PlayerResponse;
    trace.push(`player status ${j.playabilityStatus?.status} ${j.playabilityStatus?.reason ?? ""} tracks ${j.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length ?? 0}`);
    return j;
  } catch {
    return null;
  }
}

async function fromWatchPage(id: string): Promise<PlayerResponse | null> {
  try {
    const r = await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, { headers: { "user-agent": UA, "accept-language": "en-US,en" }, cache: "no-store" });
    trace.push(`watch ${r.status}`);
    if (!r.ok) return null;
    const html = await r.text();
    trace.push(`watch html ${html.length} consent ${/consent\.youtube|before you continue/i.test(html)}`);
    const m = html.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\})\s*;\s*(?:var\s|<\/script)/);
    return m ? (JSON.parse(m[1]) as PlayerResponse) : null;
  } catch {
    return null;
  }
}

async function captionText(track: CaptionTrack): Promise<string> {
  try {
    const url = new URL(track.baseUrl.startsWith("http") ? track.baseUrl : `https://www.youtube.com${track.baseUrl}`);
    url.searchParams.set("fmt", "json3");
    const r = await fetch(url, { headers: { "user-agent": UA }, cache: "no-store" });
    trace.push(`captions ${r.status}`);
    if (!r.ok) return "";
    const body = await r.text();
    trace.push(`captions body ${body.length}`);
    if (body.trimStart().startsWith("{")) return textFromJson3(JSON.parse(body));
    return textFromXml(body);
  } catch {
    return "";
  }
}

export async function fetchTranscript(id: string): Promise<Transcript> {
  let details: PlayerResponse["videoDetails"] | undefined;
  for (const get of [fromPlayer, fromWatchPage]) {
    const player = await get(id);
    if (!player) continue;
    details ??= player.videoDetails;
    if (player.playabilityStatus?.status && player.playabilityStatus.status !== "OK" && !player.captions) {
      if (player.playabilityStatus.status === "LOGIN_REQUIRED" || player.playabilityStatus.status === "ERROR") continue;
    }
    const track = pickTrack(player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []);
    if (!track) continue;
    const text = await captionText(track);
    if (text) {
      return {
        ok: true,
        title: details?.title ?? player.videoDetails?.title ?? "",
        author: details?.author ?? player.videoDetails?.author ?? "",
        seconds: Number(details?.lengthSeconds ?? player.videoDetails?.lengthSeconds ?? 0),
        text,
      };
    }
  }
  return { ok: false, error: "Couldn't get this video's transcript from YouTube. Paste it in instead: on YouTube, open the video's description, tap Show transcript, copy it all." };
}
