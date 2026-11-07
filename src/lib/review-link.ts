/**
 * A review checklist carried in a link. The Flow Board sends people to a
 * preview with ?review=<this>, and the preview shows the same steps on top
 * of the app, so what they are asked to check and where they check it are
 * one list.
 */
export interface ReviewStep {
  step: string;
  how?: string;
  /** Where in the app to look, e.g. "/practice/crew#area-full". */
  path?: string;
}

export interface ReviewList {
  title: string;
  steps: ReviewStep[];
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
/** Only a path inside this app: never another site. */
const safePath = (v: unknown) => {
  const p = clean(v, 300);
  return p.startsWith("/") && !p.startsWith("//") ? p : undefined;
};

export function encodeReview(list: ReviewList): string {
  const json = JSON.stringify(list);
  const b64 = typeof btoa === "function" ? btoa(unescape(encodeURIComponent(json))) : Buffer.from(json, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The list from a link, or null when it isn't one. Never throws. */
export function decodeReview(raw: string | null | undefined): ReviewList | null {
  if (!raw) return null;
  try {
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const json = typeof atob === "function" ? decodeURIComponent(escape(atob(b64))) : Buffer.from(b64, "base64").toString("utf8");
    const data = JSON.parse(json) as { title?: unknown; steps?: unknown };
    if (!Array.isArray(data.steps)) return null;
    const steps = data.steps
      .map((s) => s as { step?: unknown; how?: unknown; path?: unknown })
      .filter((s) => clean(s.step, 200))
      .slice(0, 30)
      .map((s) => ({ step: clean(s.step, 200), how: clean(s.how, 500) || undefined, path: safePath(s.path) }));
    return steps.length ? { title: clean(data.title, 200) || "Check this change", steps } : null;
  } catch {
    return null;
  }
}
