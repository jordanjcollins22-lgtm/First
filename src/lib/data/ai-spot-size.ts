import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

import {
  AiSizeAnswerSchema,
  SIZE_SYSTEM_PROMPT,
  cropScale,
  cropUrl,
  readAiSize,
  spotSizingPrompt,
} from "@/lib/ai-spot-size";
import { env, isAnthropicConfigured } from "@/lib/env";
import { log } from "@/lib/log";
import type { AiSpotSize } from "@/lib/spot-sizing";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Sizes for the spots a client tapped, read by Claude off a satellite crop of
 * each spot and the client's photos of it (spot-sizing.ts, source "ai").
 *
 * This runs while the client waits for their estimate, so it is held to a
 * hard deadline and never throws: no key, no map token, a slow answer or a
 * failed call all come back as fewer sizes (or none), and those spots are
 * priced from the next source down. One call per spot, a few at a time.
 */

/** The whole job, every spot. Past this the estimate goes out with what it has. */
const DEADLINE_MS = 25_000;
/** Calls at once: enough to finish a normal yard in time, few enough not to trip a rate limit. */
const CONCURRENCY = 4;
/** Photos sent per spot. Two show the spot; a third mostly costs tokens. */
const PHOTOS_PER_SPOT = 2;
/** Photos are shrunk to this on the long side: plenty to see a bed by. */
const PHOTO_EDGE = 1024;
/** The API's limit is 5 MB of base64 per picture; this leaves room for the encoding. */
const MAX_IMAGE_BYTES = 3_500_000;

type ImageMedia = "image/jpeg" | "image/png" | "image/webp";
type Picture = { media: ImageMedia; data: string };

export interface AiSpotInput {
  index: number;
  lng: number;
  lat: number;
  choices: string[];
  photoPaths: string[];
  /** The client's other taps inside this spot's picture (othersInCrop), drawn as blue pins. */
  others?: { lng: number; lat: number }[];
}

export async function aiSpotSizes(input: {
  organizationId: string;
  /** Accepted for the caller's convenience; deliberately not sent to the model, which needs the picture, not who lives there. */
  address: string;
  spots: AiSpotInput[];
}): Promise<AiSpotSize[]> {
  const spots = input.spots.filter((s) => Number.isFinite(s.lng) && Number.isFinite(s.lat) && s.choices.length > 0);
  if (spots.length === 0) return [];
  if (!isAnthropicConfigured) return [];
  const token = env.mapboxToken;
  if (!token) {
    log.warn("ai_spot_size.no_map_token", { organizationId: input.organizationId });
    return [];
  }

  const started = Date.now();
  const stop = new AbortController();
  const found: AiSpotSize[] = [];
  let failed = 0;

  try {
    const client = new Anthropic({ apiKey: env.anthropicApiKey, maxRetries: 1 });
    const admin = createAdminClient();
    const queue = [...spots];

    const worker = async () => {
      for (let spot = queue.shift(); spot && !stop.signal.aborted; spot = queue.shift()) {
        try {
          const size = await sizeOneSpot(client, admin, spot, token, stop.signal);
          if (size) found.push(size);
          else failed += 1;
        } catch (err) {
          failed += 1;
          if (!stop.signal.aborted) logCallError(err, input.organizationId, spot.index);
        }
      }
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<"late">((resolve) => {
      timer = setTimeout(() => resolve("late"), DEADLINE_MS);
    });
    const workers = Promise.all(Array.from({ length: Math.min(CONCURRENCY, spots.length) }, worker));
    const outcome = await Promise.race([workers.then(() => "done" as const), deadline]);
    clearTimeout(timer);
    if (outcome === "late") {
      stop.abort();
      log.warn("ai_spot_size.deadline", { organizationId: input.organizationId, spots: spots.length, sized: found.length });
    }
  } catch (err) {
    // Anything not caught per spot (the clients themselves). Keep what came back.
    stop.abort();
    log.error("ai_spot_size.failed", err, { organizationId: input.organizationId });
  }

  log.info("ai_spot_size.done", {
    organizationId: input.organizationId,
    spots: spots.length,
    sized: found.length,
    failed,
    ms: Date.now() - started,
  });
  // A copy, in the client's order: workers still running past the deadline
  // must not change what was handed back.
  return [...found].sort((a, b) => a.index - b.index);
}

async function sizeOneSpot(
  client: Anthropic,
  admin: ReturnType<typeof createAdminClient>,
  spot: AiSpotInput,
  token: string,
  signal: AbortSignal
): Promise<AiSpotSize | null> {
  const scale = cropScale(spot.lat, spot.choices);
  const [satellite, photos] = await Promise.all([
    fetchSatellite(cropUrl(spot, scale, token, spot.others ?? []), signal),
    Promise.all(spot.photoPaths.slice(0, PHOTOS_PER_SPOT).map((path) => fetchPhoto(admin, path))),
  ]);
  if (!satellite) return null;
  const own = photos.filter((p): p is Picture => p !== null);

  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    { type: "text", text: "Satellite picture, centred on the pin:" },
    { type: "image", source: { type: "base64", media_type: satellite.media, data: satellite.data } },
    ...own.flatMap((p, i): Anthropic.Beta.BetaContentBlockParam[] => [
      { type: "text", text: `Client photo ${i + 1} of the same spot:` },
      { type: "image", source: { type: "base64", media_type: p.media, data: p.data } },
    ]),
    { type: "text", text: spotSizingPrompt({ choices: spot.choices, scale, photoCount: own.length, otherPins: spot.others?.length ?? 0 }) },
  ];

  const response = await client.beta.messages.parse(
    {
      model: "claude-opus-5-5",
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      // Reading a size off a picture, with the client waiting. Low effort
      // keeps each call to a few seconds so a whole yard fits the deadline.
      output_config: { effort: "low", format: betaZodOutputFormat(AiSizeAnswerSchema) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SIZE_SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    },
    { signal, timeout: DEADLINE_MS }
  );
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;

  return readAiSize(response.parsed_output, spot.index, {
    choices: spot.choices,
    cropAreaSqft: scale.spanFeet * scale.spanFeet,
  });
}

/** The satellite crop. Fetched here so the map token never leaves this server. */
async function fetchSatellite(url: string, signal: AbortSignal): Promise<Picture | null> {
  const res = await fetch(url, { signal, cache: "no-store" });
  if (!res.ok) {
    log.warn("ai_spot_size.map_failed", { status: res.status });
    return null;
  }
  const media = imageMedia(res.headers.get("content-type"));
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!media || bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;
  return { media, data: bytes.toString("base64") };
}

/**
 * One of the client's photos, shrunk. A phone photo is often over the API's
 * limit as it is, and the detail past a thousand pixels doesn't change a
 * size. A photo that can't be read is left out; the spot is still sized from
 * the satellite picture.
 */
async function fetchPhoto(admin: ReturnType<typeof createAdminClient>, path: string): Promise<Picture | null> {
  try {
    const { data, error } = await admin.storage.from("job-photos").download(path);
    if (error || !data) return null;
    const bytes = Buffer.from(await data.arrayBuffer());
    try {
      const sharp = (await import("sharp")).default;
      const small = await sharp(bytes)
        .rotate()
        .resize(PHOTO_EDGE, PHOTO_EDGE, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      if (small.length > 0 && small.length <= MAX_IMAGE_BYTES) return { media: "image/jpeg", data: small.toString("base64") };
    } catch {
      // No image library here: send it as it is, if it is small enough.
    }
    const media = imageMedia(data.type) ?? mediaFromPath(path);
    if (!media || bytes.length > MAX_IMAGE_BYTES) return null;
    return { media, data: bytes.toString("base64") };
  } catch {
    return null;
  }
}

function imageMedia(type: string | null | undefined): ImageMedia | null {
  const t = (type ?? "").split(";")[0].trim().toLowerCase();
  if (t === "image/jpeg" || t === "image/jpg") return "image/jpeg";
  if (t === "image/png") return "image/png";
  if (t === "image/webp") return "image/webp";
  return null;
}

function mediaFromPath(path: string): ImageMedia | null {
  if (/\.jpe?g$/i.test(path)) return "image/jpeg";
  if (/\.png$/i.test(path)) return "image/png";
  if (/\.webp$/i.test(path)) return "image/webp";
  return null;
}

function logCallError(err: unknown, organizationId: string, index: number) {
  if (err instanceof Anthropic.RateLimitError) log.warn("ai_spot_size.rate_limited", { organizationId, index });
  else if (err instanceof Anthropic.APIError) log.warn("ai_spot_size.api_error", { organizationId, index, status: err.status, message: err.message });
  else log.warn("ai_spot_size.spot_failed", { organizationId, index, error: err instanceof Error ? err.message : String(err) });
}
