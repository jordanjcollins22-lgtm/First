"use client";

import { useState, useTransition } from "react";
import { ExternalLink, Monitor, Plus, Smartphone, Trash2 } from "lucide-react";

import { SiteView } from "@/components/website/site-view";
import { publishWebsite } from "@/lib/actions/website-actions";
import type { WebsiteState } from "@/lib/data/website";
import { MAX_REASONS, MAX_SERVICES, websiteLinks, type WebsiteContent } from "@/lib/website";

/**
 * Marketing › Website in the new layout: every page a customer can land on,
 * viewable right here, and the website itself written and published from
 * the same screen.
 *
 * The website preview is the real page's own component fed the draft, so it
 * changes as you type. The booking, quick mow and salt pages are the live
 * pages in a frame; the booking page opens in its preview mode, so looking
 * at it here counts no visit and books nothing.
 */

type Tab = "website" | "book" | "mow" | "salt";
type Device = "phone" | "desktop";

const TABS: { key: Tab; label: string }[] = [
  { key: "website", label: "Website" },
  { key: "book", label: "Booking page" },
  { key: "mow", label: "Quick mow page" },
  { key: "salt", label: "Salt pre-book page" },
];

export function WebsiteStudio({ website }: { website: WebsiteState }) {
  const [tab, setTab] = useState<Tab>("website");
  const [device, setDevice] = useState<Device>("desktop");
  const links = websiteLinks(website.orgSlug);
  const frameSrc = tab === "book" ? `${links.book}${links.book.includes("?") ? "&" : "?"}preview=1` : tab === "mow" ? links.mow : links.salt;
  const liveHref = tab === "website" ? links.site : tab === "book" ? links.book : frameSrc;

  return (
    <section className="rounded-2xl border bg-card/60 p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Website pages" className="flex flex-wrap gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={
                "min-h-11 rounded-lg border px-4 text-sm font-bold " +
                (tab === t.key ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-muted")
              }
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div role="group" aria-label="Preview size" className="flex rounded-lg bg-muted p-1">
            {(["phone", "desktop"] as const).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={device === d}
                onClick={() => setDevice(d)}
                className={"flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold " + (device === d ? "bg-card shadow-sm" : "text-muted-foreground")}
              >
                {d === "phone" ? <Smartphone className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
                {d === "phone" ? "Phone" : "Desktop"}
              </button>
            ))}
          </div>
          <a
            href={liveHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border bg-card px-3 text-sm font-semibold text-primary hover:bg-muted"
          >
            Open live <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </div>

      {tab === "website" ? (
        <WebsiteEditor website={website} device={device} />
      ) : (
        <Frame device={device}>
          <iframe key={frameSrc} src={frameSrc} title={TABS.find((t) => t.key === tab)?.label} className="h-[760px] w-full bg-white" />
        </Frame>
      )}
    </section>
  );
}

function Frame({ device, children }: { device: Device; children: React.ReactNode }) {
  return (
    <div className="flex justify-center rounded-xl bg-muted/60 p-3">
      <div
        className={
          "w-full overflow-hidden border bg-white shadow-lg " +
          (device === "phone" ? "max-w-[390px] rounded-[2rem] border-4 border-foreground/80" : "rounded-lg")
        }
      >
        {children}
      </div>
    </div>
  );
}

function WebsiteEditor({ website, device }: { website: WebsiteState; device: Device }) {
  const [saved, setSaved] = useState<WebsiteContent>(website.content);
  const [draft, setDraft] = useState<WebsiteContent>(website.content);
  const [publishedAt, setPublishedAt] = useState(website.publishedAt);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);

  const set = <K extends keyof WebsiteContent>(key: K, value: WebsiteContent[K]) => setDraft((d) => ({ ...d, [key]: value }));

  function publish() {
    setError(null);
    startTransition(async () => {
      const r = await publishWebsite(draft);
      if (!r.ok) return setError(r.error);
      setSaved(draft);
      setPublishedAt(r.publishedAt);
    });
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="grid content-start gap-4">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">
            {publishedAt
              ? `Published ${new Date(publishedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`
              : "Not published yet. The live page shows the starting text below until you publish."}
            {dirty && " You have changes that aren't live yet."}
          </p>
          {!website.ready && (
            <p className="mt-2 text-sm font-medium text-orange-700 dark:text-orange-300">
              The website table isn&apos;t set up in the database yet, so publishing won&apos;t work until it is.
            </p>
          )}
          {error && <p className="mt-2 text-sm font-medium text-destructive">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={publish}
              disabled={!dirty || pending}
              className="min-h-11 flex-1 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {pending ? "Publishing…" : "Publish"}
            </button>
            <button
              type="button"
              onClick={() => setDraft(saved)}
              disabled={!dirty || pending}
              className="min-h-11 rounded-lg border px-4 text-sm font-semibold hover:bg-muted disabled:opacity-50"
            >
              Undo changes
            </button>
          </div>
        </div>

        <Group title="Top of the page">
          <Field label="Business name" value={draft.businessName} onChange={(v) => set("businessName", v)} max={80} />
          <Field label="Headline" value={draft.heroHeadline} onChange={(v) => set("heroHeadline", v)} max={120} />
          <Field label="Under the headline" value={draft.heroSub} onChange={(v) => set("heroSub", v)} max={300} long />
          <Field label="Main button" value={draft.ctaLabel} onChange={(v) => set("ctaLabel", v)} max={40} hint="Goes to the booking page." />
        </Group>

        <Group title="Contact">
          <Field label="Phone" value={draft.phone} onChange={(v) => set("phone", v)} max={30} />
          <Field label="Email" value={draft.email} onChange={(v) => set("email", v)} max={120} />
        </Group>

        <Group title={`Services (${draft.services.length}/${MAX_SERVICES})`}>
          {draft.services.map((s, i) => (
            <div key={i} className="grid gap-2 rounded-lg border p-2.5">
              <div className="flex gap-2">
                <input
                  aria-label={`Service ${i + 1} name`}
                  value={s.name}
                  maxLength={60}
                  onChange={(e) => set("services", draft.services.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  className="min-h-10 flex-1 rounded-md border bg-background px-2.5 text-sm font-semibold"
                />
                <button
                  type="button"
                  aria-label={`Remove ${s.name || "service"}`}
                  onClick={() => set("services", draft.services.filter((_, j) => j !== i))}
                  className="flex min-h-10 min-w-10 items-center justify-center rounded-md border text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <textarea
                aria-label={`Service ${i + 1} description`}
                value={s.blurb}
                maxLength={200}
                rows={2}
                onChange={(e) => set("services", draft.services.map((x, j) => (j === i ? { ...x, blurb: e.target.value } : x)))}
                className="rounded-md border bg-background px-2.5 py-1.5 text-sm"
              />
            </div>
          ))}
          {draft.services.length < MAX_SERVICES && (
            <button
              type="button"
              onClick={() => set("services", [...draft.services, { name: "New service", blurb: "" }])}
              className="flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-dashed text-sm font-semibold hover:bg-muted"
            >
              <Plus className="h-4 w-4" /> Add a service
            </button>
          )}
        </Group>

        <Group title="Why us">
          <Field label="About the business" value={draft.about} onChange={(v) => set("about", v)} max={1200} long />
          {draft.whyUs.map((r, i) => (
            <div key={i} className="flex gap-2">
              <input
                aria-label={`Reason ${i + 1}`}
                value={r}
                maxLength={120}
                onChange={(e) => set("whyUs", draft.whyUs.map((x, j) => (j === i ? e.target.value : x)))}
                className="min-h-10 flex-1 rounded-md border bg-background px-2.5 text-sm"
              />
              <button
                type="button"
                aria-label="Remove reason"
                onClick={() => set("whyUs", draft.whyUs.filter((_, j) => j !== i))}
                className="flex min-h-10 min-w-10 items-center justify-center rounded-md border text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {draft.whyUs.length < MAX_REASONS && (
            <button
              type="button"
              onClick={() => set("whyUs", [...draft.whyUs, ""])}
              className="flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-dashed text-sm font-semibold hover:bg-muted"
            >
              <Plus className="h-4 w-4" /> Add a reason
            </button>
          )}
        </Group>

        <Group title="Service area & offers">
          <Field label="Where you work" value={draft.serviceArea} onChange={(v) => set("serviceArea", v)} max={400} long />
          <Toggle label="Show the quick mow offer" checked={draft.showQuickMow} onChange={(v) => set("showQuickMow", v)} />
          <Toggle label="Show the salt pre-book offer" checked={draft.showSalt} onChange={(v) => set("showSalt", v)} />
        </Group>
      </div>

      <div className="xl:sticky xl:top-20 xl:self-start">
        <Frame device={device}>
          <div className="max-h-[760px] overflow-y-auto">
            <SiteView content={draft} orgSlug={website.orgSlug} newTab />
          </div>
        </Frame>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-3 rounded-xl border bg-card p-4">
      <legend className="px-1 text-sm font-extrabold">{title}</legend>
      {children}
    </fieldset>
  );
}

function Field({
  label,
  value,
  onChange,
  max,
  long,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max: number;
  long?: boolean;
  hint?: string;
}) {
  const cls = "w-full rounded-md border bg-background px-2.5 text-sm";
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-semibold">{label}</span>
      {long ? (
        <textarea value={value} maxLength={max} rows={3} onChange={(e) => onChange(e.target.value)} className={cls + " py-1.5"} />
      ) : (
        <input value={value} maxLength={max} onChange={(e) => onChange(e.target.value)} className={cls + " min-h-10"} />
      )}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-10 cursor-pointer items-center gap-2.5 text-sm font-medium">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-5 accent-[var(--primary)]" />
      {label}
    </label>
  );
}
