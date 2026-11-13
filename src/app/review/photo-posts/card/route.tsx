import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { NextRequest } from "next/server";

import { reviewPagesEnabled } from "@/lib/review-pages";
import { DEFAULT_LAYOUT, photoSpaces } from "@/lib/social-layout";
import { cutPhoto, drawCard } from "@/lib/social/card-picture";
import { DEFAULT_PHONE } from "@/lib/social/photo-drafts";

/**
 * The post picture for the preview review page's sample photos, drawn by
 * the same code as the real picture route. Only the sample photos that ship
 * with the site can be named; nothing is read from the database.
 */
export const dynamic = "force-dynamic";

const SAMPLES = new Set(["front-beds", "side-yard", "leaf-cleanup", "bed-edging"]);

export async function GET(request: NextRequest) {
  if (!reviewPagesEnabled()) return new Response("Not found", { status: 404 });
  const q = request.nextUrl.searchParams;
  const photo = q.get("photo") ?? "";
  if (!SAMPLES.has(photo)) return new Response("Not found", { status: 404 });
  const split = q.get("shape") === "pair";
  const hook = (q.get("hook") ?? "").slice(0, 140);
  const layout = DEFAULT_LAYOUT;
  const spaces = photoSpaces(split ? "split" : "photo", layout);
  const file = (stage: "before" | "after") => readFile(join(process.cwd(), "public/review/photo-posts", `${photo}-${stage}.jpg`));
  const [before, after] = await Promise.all([
    split && spaces.before ? cutPhoto(await file("before"), spaces.before, null, layout.fit) : Promise.resolve(null),
    cutPhoto(await file("after"), spaces.after, null, layout.fit),
  ]);
  return drawCard({ style: split ? "split" : "photo", spaces, layout, before, after, hook, name: "JS Landscaping MD", phone: DEFAULT_PHONE });
}
