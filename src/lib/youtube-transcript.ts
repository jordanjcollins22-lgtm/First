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

const CLIENTS = [
  { name: "ANDROID", ua: "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip", client: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 34 } },
  { name: "IOS", ua: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)", client: { clientName: "IOS", clientVersion: "20.10.4", deviceMake: "Apple", deviceModel: "iPhone16,2", osName: "iPhone", osVersion: "18.3.2.22D82" } },
  { name: "TV", ua: "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version", client: { clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER", clientVersion: "2.0" }, embed: true },
  { name: "WEB_EMBED", ua: UA, client: { clientName: "WEB_EMBEDDED_PLAYER", clientVersion: "1.20250310.01.00" }, embed: true },
  { name: "MWEB", ua: UA, client: { clientName: "MWEB", clientVersion: "2.20250311.03.00" } },
];

async function fromClient(id: string, c: (typeof CLIENTS)[number]): Promise<PlayerResponse | null> {
  try {
    const r = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": c.ua },
      body: JSON.stringify({
        videoId: id,
        context: { client: { ...c.client, hl: "en", gl: "US" }, ...(c.embed ? { thirdParty: { embedUrl: "https://www.youtube.com/" } } : {}) },
      }),
      cache: "no-store",
    });
    trace.push(`${c.name} ${r.status}`);
    if (!r.ok) return null;
    const j = (await r.json()) as PlayerResponse;
    trace.push(`${c.name} status ${j.playabilityStatus?.status} ${j.playabilityStatus?.reason ?? ""} tracks ${j.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length ?? 0}`);
    return j;
  } catch (e) {
    trace.push(`${c.name} threw ${String(e).slice(0, 80)}`);
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
    const j = m ? (JSON.parse(m[1]) as PlayerResponse) : null;
    trace.push(`watch match ${Boolean(m)} status ${j?.playabilityStatus?.status} tracks ${j?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length ?? 0}`);
    return j;
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
  trace.length = 0;
  const steps = [...CLIENTS.map((c) => () => fromClient(id, c)), () => fromWatchPage(id)];
  for (const get of steps) {
    const player = await get();
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

/** A video's title and channel from YouTube's oEmbed, which works even where the player is blocked. */
export async function fetchTitle(id: string): Promise<{ title: string; author: string }> {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`, { cache: "no-store" });
    trace.push(`oembed ${r.status}`);
    if (!r.ok) return { title: "", author: "" };
    const j = (await r.json()) as { title?: string; author_name?: string };
    return { title: j.title ?? "", author: j.author_name ?? "" };
  } catch {
    return { title: "", author: "" };
  }
}
