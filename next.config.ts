import type { NextConfig } from "next";

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
