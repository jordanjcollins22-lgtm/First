import type { NextConfig } from "next";

import { MOVED } from "./src/lib/moved-routes";

/**
 * Files in /public that the browser asks for on nearly every visit.
 *
 * Everything Next builds itself — the JavaScript, the CSS — carries a content
 * hash in its filename and is already served immutable for a year. Files
 * dropped in /public are not: they get no cache lifetime at all, so a phone
 * re-downloads the app icons and the manifest every time somebody opens a
 * booking link, over their own data, for bytes that have not changed since
 * the icons were drawn.
 */
const CACHEABLE_PUBLIC_FILES = [
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/manifest.json",
];

const DAY = 60 * 60 * 24;
const WEEK = DAY * 7;

const nextConfig: NextConfig = {
  /**
   * The pages that were absorbed into a workflow module.
   *
   * Read straight from the table in src/lib/modules.ts, so the redirect and
   * the subtab it lands on cannot drift apart -- a test walks that table and
   * fails if a destination stops existing.
   *
   * Done here rather than by replacing the page files, because the module
   * pages import those page components: Sales renders the pipeline page,
   * Marketing renders the map. Next checks redirects before the filesystem,
   * so the URL is unreachable while the component behind it is still there to
   * be composed. Query strings are carried across, so a link to
   * /attractors?zone=abc still lands on that zone.
   *
   * Temporary (307) rather than permanent (308) on purpose: a 308 is cached
   * by the browser forever, and an address the business might want back is
   * not worth making unrecoverable to save one hop.
   *
   * Nothing public is in here. Booking links, proposal tokens, progress
   * links, advertiser uploads, weed QR codes and stock stickers are printed on
   * paper and sitting in people's inboxes; they keep their addresses, and a
   * test asserts it. So do the job deep links -- the work order and the
   * directions -- which crews open from their phones.
   */
  async redirects() {
    return Object.entries(MOVED).map(([source, destination]) => ({
      source,
      destination,
      permanent: false,
    }));
  },

  async headers() {
    return CACHEABLE_PUBLIC_FILES.map((source) => ({
      source,
      headers: [
        {
          key: "Cache-Control",
          // A day, then a week of serving the old copy while a new one is
          // fetched behind it. These filenames are fixed, so they cannot be
          // cached forever the way a hashed asset can — replacing an icon has
          // to actually reach people, and it does, by tomorrow.
          value: `public, max-age=${DAY}, stale-while-revalidate=${WEEK}`,
        },
      ],
    }));
  },
};

export default nextConfig;
