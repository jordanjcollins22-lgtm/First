/*
 * Keeps the field pages openable with no signal.
 *
 * An evaluation or a job can be somewhere with no signal at all. Every page
 * the crew or the evaluator opens with signal is kept on the phone, and
 * opened from there when there is none, so the crew sheet, the visit and
 * the site map still come up; photos taken on them are kept by the app's
 * outbox and upload later. With signal, pages always come fresh from the
 * server: the kept copy is only ever the fallback.
 *
 * Only GETs on this site. Nothing is kept from the API, auth or anything
 * sent to the server.
 */

const VERSION = "field-v1";
const PAGES = `${VERSION}-pages`;
const ASSETS = `${VERSION}-assets`;

/** The pages worth having with no signal: the ones used on a property. */
const FIELD_PAGE = /^\/(evaluate(\/|$)|today$|my-day$|jobs\/[^/]+\/(work-order|site-map|directions|photos)$|crew\/|prep\/)/;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => !name.startsWith(VERSION)).map((name) => caches.delete(name)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // The app's own code, styles and fonts: named by content, so a kept copy is always right.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSETS);
        const kept = await cache.match(request);
        if (kept) return kept;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })()
    );
    return;
  }

  // A field page, opened fresh when there is signal, kept for when there isn't.
  if (request.mode === "navigate" && FIELD_PAGE.test(url.pathname.slice(1))) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(PAGES);
        try {
          const response = await fetch(request);
          // Not a login page sent in its place, and not an error.
          if (response.ok && !response.redirected) cache.put(request, response.clone());
          return response;
        } catch {
          const kept = (await cache.match(request)) || (await cache.match(request, { ignoreSearch: true }));
          return kept || noSignalPage();
        }
      })()
    );
  }
});

/*
 * Pages reached by a tap inside the app never come through here as a page
 * (the app fetches only what changed), and the code a page needs was loaded
 * before this worker started. So the app says which field page it has open
 * and which of its files it loaded, and they are kept now, with signal.
 */
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "keep") return;
  event.waitUntil(
    (async () => {
      if (typeof data.page === "string") {
        const url = new URL(data.page, self.location.origin);
        if (url.origin === self.location.origin && FIELD_PAGE.test(url.pathname.slice(1))) {
          try {
            const response = await fetch(url.href, { credentials: "include", headers: { Accept: "text/html" } });
            if (response.ok && !response.redirected) await (await caches.open(PAGES)).put(url.href, response);
          } catch {
            // No signal right now; it is kept the next time it is opened with signal.
          }
        }
      }
      if (Array.isArray(data.assets)) {
        const cache = await caches.open(ASSETS);
        for (const asset of data.assets.slice(0, 200)) {
          try {
            const url = new URL(asset, self.location.origin);
            if (url.origin !== self.location.origin || !url.pathname.startsWith("/_next/static/")) continue;
            if (await cache.match(url.href)) continue;
            const response = await fetch(url.href);
            if (response.ok) await cache.put(url.href, response);
          } catch {
            // Skipped; fetched through here next time.
          }
        }
      }
    })()
  );
});

function noSignalPage() {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>No signal</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;margin:0;padding:32px 20px;background:#f8faf8;color:#14231a}main{max-width:420px;margin:0 auto}h1{font-size:22px;margin:0 0 8px}p{line-height:1.5;color:#3f5247}button{margin-top:16px;height:48px;width:100%;border:0;border-radius:10px;background:#15803d;color:#fff;font-size:16px;font-weight:600}</style></head>
<body><main><h1>No signal</h1><p>This page wasn't opened on this phone while there was signal, so it can't be shown yet.</p><p>Photos you already took are saved on this phone and upload by themselves when there's signal.</p><button onclick="location.reload()">Try again</button></main></body></html>`;
  return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
