"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, ChevronUp, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { campaignHeadline, CAMPAIGN_PLACEHOLDERS, money, variantScore, type AerationPricing } from "@/lib/campaign";
import {
  createCampaign,
  saveCampaignSettings,
  saveVariant,
  sendCampaignTest,
  setCampaignStatus,
  startCampaign,
} from "@/lib/actions/campaign-actions";
import type { CampaignView, CampaignVariantView, Readiness } from "@/lib/data/campaigns";

/**
 * The campaign screen.
 *
 * The domain's readiness first, because nothing else matters until it is
 * green. Then each campaign: where it stands, the three wordings with
 * their numbers and the share of tomorrow's sends each will get, the
 * pricing, and the buttons.
 */
export function CampaignPanel({ campaigns, readiness, audience }: { campaigns: CampaignView[]; readiness: Readiness; audience: number }) {
  return (
    <div className="flex flex-col gap-4">
      <ReadinessCard readiness={readiness} audience={audience} />
      {campaigns.map((campaign) => (
        <CampaignCard key={campaign.id} campaign={campaign} readiness={readiness} audience={audience} />
      ))}
      <NewCampaign />
    </div>
  );
}

function ReadinessCard({ readiness, audience }: { readiness: Readiness; audience: number }) {
  const rows = [
    { ok: readiness.resend, label: "Email provider key" },
    { ok: Boolean(readiness.marketingDomain), label: readiness.marketingDomain ? `Marketing domain ${readiness.marketingDomain} verified` : "Marketing domain verified" },
    { ok: Boolean(readiness.sender), label: readiness.sender ? `Sending as ${readiness.sender}` : "An address to send from" },
    { ok: readiness.postalAddress, label: "Business postal address on file" },
  ];
  return (
    <section className={cn("rounded-xl border p-4", readiness.ready ? "border-primary/40 bg-primary/5" : "border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10")}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{readiness.ready ? "Ready to send" : "Not ready to send yet"}</h2>
        <p className="text-sm text-muted-foreground">{audience.toLocaleString("en-US")} people on the list can be written to</p>
      </div>
      <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-1.5">
            {row.ok ? <Check className="h-4 w-4 text-primary" /> : <X className="h-4 w-4 text-amber-700" />}
            {row.label}
          </li>
        ))}
      </ul>
      {readiness.problems.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
          {readiness.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {!readiness.ready && (
        <p className="mt-2 text-xs text-muted-foreground">
          Sent from a separate marketing subdomain on purpose, so a bad day for the campaign can never touch the domain proposals and invoices go out on.
        </p>
      )}
    </section>
  );
}

function CampaignCard({ campaign, readiness, audience }: { campaign: CampaignView; readiness: Readiness; audience: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  function run(work: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setError(null);
    setMessage(null);
    start(async () => {
      const result = await work();
      if (!result.ok) return setError(result.error ?? "Could not do that.");
      if (result.message) setMessage(result.message);
      router.refresh();
    });
  }

  const status = campaign.status;
  return (
    <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">{campaign.name}</h2>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-semibold",
            status === "running" ? "bg-primary/10 text-primary" : status === "paused" ? "bg-amber-100 text-amber-900" : "bg-muted text-muted-foreground"
          )}
        >
          {status === "running" ? "Sending" : status === "paused" ? "Paused" : status === "done" ? "Finished" : "Draft"}
        </span>
      </div>
      <p className="mt-0.5 text-sm text-muted-foreground">{campaignHeadline(campaign.stats)}</p>
      {campaign.pausedReason && <p className="mt-1 text-sm text-amber-800">{campaign.pausedReason}</p>}

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Credit</dt>
          <dd className="font-medium">{money(campaign.offerCents)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Code expires</dt>
          <dd className="font-medium">{campaign.codeExpiresOn}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Today&apos;s allowance</dt>
          <dd className="font-medium tabular-nums">{campaign.todaysCap} emails</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Bounced / spam</dt>
          <dd className="font-medium tabular-nums">
            {campaign.stats.bounced} / {campaign.stats.complained}
          </dd>
        </div>
      </dl>

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">The three wordings</p>
        <p className="text-xs text-muted-foreground">
          Each one&apos;s share of the next sends comes from how it has done. The one that books gets more; none drops below fifteen percent until the numbers are in.
        </p>
        <ul className="mt-2 flex flex-col gap-2">
          {campaign.variants.map((variant) => (
            <VariantCard key={variant.id} campaignId={campaign.id} variant={variant} share={campaign.shares[variant.id] ?? 0} />
          ))}
        </ul>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {status === "draft" && (
          <Button type="button" size="sm" disabled={pending || !readiness.ready} onClick={() => run(() => startCampaign(campaign.id))}>
            Start sending to {audience.toLocaleString("en-US")} people
          </Button>
        )}
        {status === "running" && (
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => setCampaignStatus(campaign.id, "paused"))}>
            Pause
          </Button>
        )}
        {status === "paused" && (
          <Button type="button" size="sm" disabled={pending || !readiness.ready} onClick={() => run(() => setCampaignStatus(campaign.id, "running"))}>
            Resume
          </Button>
        )}
        {status !== "done" && status !== "draft" && (
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setCampaignStatus(campaign.id, "done"))}>
            Finish
          </Button>
        )}
        <button type="button" onClick={() => setShowSettings((v) => !v)} className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          {showSettings ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          Credit, expiry and pricing
        </button>
      </div>
      {!readiness.ready && status === "draft" && <p className="mt-1 text-xs text-muted-foreground">Start unlocks once the checklist above is green.</p>}
      {message && <p className="mt-2 text-xs text-primary">{message}</p>}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      {showSettings && <SettingsForm campaign={campaign} />}
    </section>
  );
}

function VariantCard({ campaignId, variant, share }: { campaignId: string; variant: CampaignVariantView; share: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(variant.subject);
  const [body, setBody] = useState(variant.body);
  const [enabled, setEnabled] = useState(variant.enabled);
  const [testTo, setTestTo] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const dirty = subject !== variant.subject || body !== variant.body || enabled !== variant.enabled;
  const rate = variant.sent > 0 ? `${Math.round((variant.booked / variant.sent) * 1000) / 10}%` : "no sends yet";

  function save() {
    setError(null);
    setNote(null);
    start(async () => {
      const result = await saveVariant({ id: variant.id, subject, body, enabled });
      if (!result.ok) return setError(result.error);
      setNote("Saved.");
      router.refresh();
    });
  }

  function test() {
    setError(null);
    setNote(null);
    start(async () => {
      const result = await sendCampaignTest({ campaignId, variantId: variant.id, to: testTo });
      if (!result.ok) return setError(result.error);
      setNote(result.message ?? "Sent.");
    });
  }

  return (
    <li className={cn("rounded-lg border border-border bg-background/60", open && "border-primary/50")}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-3 px-3 py-2.5 text-left">
        <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{variant.key}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold">{variant.name}</span>
            {!variant.enabled && <span className="text-[11px] text-muted-foreground">off</span>}
          </span>
          <span className="block truncate text-sm text-muted-foreground">{variant.subject}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">
            {variant.sent} sent, {variant.clicked} opened the offer, {variant.booked} booked ({rate}). Next sends: {Math.round(share * 100)}%. Score {variantScore(variant).toFixed(2)}.
          </span>
        </span>
        {open ? <ChevronUp className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" disabled={pending} />
            Use this wording
          </label>
          <label htmlFor={`subject-${variant.id}`} className="flex flex-col gap-1">
            <span className="text-xs font-medium">Subject</span>
            <input
              id={`subject-${variant.id}`}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={pending}
              className="h-10 rounded-md border border-border bg-background px-3 text-sm"
            />
          </label>
          <label htmlFor={`body-${variant.id}`} className="flex flex-col gap-1">
            <span className="text-xs font-medium">Email</span>
            <Textarea id={`body-${variant.id}`} value={body} onChange={(e) => setBody(e.target.value)} disabled={pending} rows={14} className="text-sm" />
          </label>
          {variant.needsPrice && <p className="text-xs text-muted-foreground">This wording quotes a price, so it only goes to people whose lot size we can read.</p>}
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium">What the braces fill in</summary>
            <ul className="mt-1 grid gap-0.5 sm:grid-cols-2">
              {CAMPAIGN_PLACEHOLDERS.map((p) => (
                <li key={p.key}>
                  <code className="rounded bg-muted px-1">{`{${p.key}}`}</code> {p.means}
                </li>
              ))}
            </ul>
          </details>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" disabled={pending || !dirty} onClick={save}>
              Save
            </Button>
            <input
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="you@jslandscapingmd.com"
              inputMode="email"
              className="h-9 w-56 rounded-md border border-border bg-background px-2 text-sm"
            />
            <Button type="button" size="sm" variant="outline" disabled={pending || !testTo} onClick={test}>
              Send me a test
            </Button>
          </div>
          {note && <p className="text-xs text-primary">{note}</p>}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </li>
  );
}

const PRICING_FIELDS: { key: keyof AerationPricing; label: string; hint: string; money?: boolean }[] = [
  { key: "seedPer1kCents", label: "Seed per 1,000 sq ft", hint: "What the seed costs you, marked up as you like", money: true },
  { key: "minutesPer1k", label: "Minutes per 1,000 sq ft", hint: "Crew time to aerate and seed it" },
  { key: "hourlyRateCents", label: "Crew rate per hour", hint: "What an hour is charged at", money: true },
  { key: "aeratorCents", label: "Aerator, per visit", hint: "The machine for the day", money: true },
  { key: "minimumCents", label: "Minimum visit", hint: "Never less than this", money: true },
];

function SettingsForm({ campaign }: { campaign: CampaignView }) {
  const router = useRouter();
  const [offer, setOffer] = useState((campaign.offerCents / 100).toFixed(2));
  const [expires, setExpires] = useState(campaign.codeExpiresOn);
  const [pricing, setPricing] = useState<Record<string, string>>(
    Object.fromEntries(PRICING_FIELDS.map((f) => [f.key, f.money ? (campaign.pricing[f.key] / 100).toFixed(2) : String(campaign.pricing[f.key])]))
  );
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    setNote(null);
    const parsed: Partial<AerationPricing> = {};
    for (const f of PRICING_FIELDS) {
      const n = Number(pricing[f.key]);
      if (Number.isFinite(n) && n >= 0) parsed[f.key] = f.money ? Math.round(n * 100) : n;
    }
    start(async () => {
      const result = await saveCampaignSettings({ id: campaign.id, offerDollars: offer, codeExpiresOn: expires, pricing: parsed });
      if (!result.ok) return setError(result.error);
      setNote("Saved. Emails not yet sent use the new numbers.");
      router.refresh();
    });
  }

  return (
    <div className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-xs">
        Credit, in dollars
        <input value={offer} onChange={(e) => setOffer(e.target.value)} inputMode="decimal" className="h-9 rounded-md border border-border bg-background px-2 text-sm" />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Code expires on
        <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className="h-9 rounded-md border border-border bg-background px-2 text-sm" />
      </label>
      {PRICING_FIELDS.map((f) => (
        <label key={f.key} className="flex flex-col gap-1 text-xs">
          {f.label}
          <input
            value={pricing[f.key]}
            onChange={(e) => setPricing({ ...pricing, [f.key]: e.target.value })}
            inputMode="decimal"
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          />
          <span className="text-[11px] text-muted-foreground">{f.hint}</span>
        </label>
      ))}
      <div className="flex items-center gap-2 sm:col-span-2">
        <Button type="button" size="sm" disabled={pending} onClick={save}>
          Save
        </Button>
        {note && <p className="text-xs text-primary">{note}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}

function NewCampaign() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Fall aeration and overseeding");
  const [offer, setOffer] = useState("17.43");
  const [expires, setExpires] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 10);
    return d.toISOString().slice(0, 10);
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function create() {
    setError(null);
    start(async () => {
      const result = await createCampaign({ name, offerDollars: offer, codeExpiresOn: expires, pricing: {} });
      if (!result.ok) return setError(result.error);
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)} className="w-fit">
        New campaign
      </Button>
    );
  }
  return (
    <section className="rounded-xl border border-border bg-card/60 p-4">
      <h2 className="text-base font-semibold">New campaign</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} className="h-9 rounded-md border border-border bg-background px-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Credit, in dollars
          <input value={offer} onChange={(e) => setOffer(e.target.value)} inputMode="decimal" className="h-9 rounded-md border border-border bg-background px-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Code expires on
          <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className="h-9 rounded-md border border-border bg-background px-2 text-sm" />
        </label>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">It starts with three wordings and the default pricing. Edit both before you press Start.</p>
      <div className="mt-3 flex gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={create}>
          Create
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </section>
  );
}
