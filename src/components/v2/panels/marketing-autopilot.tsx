import { loadDigitalPanel, type IntegrationStatus } from "@/lib/data/marketing-panels";
import type { Automation } from "@/lib/marketing/autopilot-settings";
import { money } from "@/lib/marketing/money";
import { SEASON_INFO } from "@/lib/marketing/seasonal";

import {
  AutomationSwitches,
  ChannelTable,
  GoogleRunButton,
  ListSettings,
  
  NumberSettings,
  SeasonalModeForm,
  SeasonCard,
  SpendForms,
} from "./marketing-autopilot-controls";
import { Kpi, NeedsYou, pct, Section, type NeedsYouItem, type Tone } from "./marketing-panel-parts";

/**
 * Marketing › Digital marketing: what came from where and what it cost,
 * Google's state, and the switches for everything that runs on its own.
 *
 * Needs-you first (a review to answer, Google broken, posts stuck, a season
 * waiting to start, spend out of band), then the numbers against target,
 * then the channel table, then the machinery.
 */

const PROVIDER_LABEL: Record<string, string> = {
  google_business: "Google Business Profile",
  google_ads: "Google Ads",
  google_lsa: "Local Services Ads",
  google_places: "Rank tracker key",
};

const INTEGRATIONS_HREF = "/v2/admin?choice=settings";

const DIGITAL_SWITCHES: Automation[] = ["review_replies", "gbp_weekly_post", "social_autopost", "social_reslot", "ads_import", "rank_weekly", "seasonal_email"];

/** Search and LSA cost per lead above these is worth a look (report's planning bands). */
const CPL_TARGET: Partial<Record<string, number>> = { google_lsa: 6500, google_ads: 9000 };

function statusText(s: IntegrationStatus): string {
  if (s.status === "connected") return "Connected";
  if (s.status === "error") return `Problem: ${s.lastError ?? "unknown"}`;
  return "Not connected";
}

export async function MarketingAutopilotPanel() {
  const d = await loadDigitalPanel();
  const { settings, started } = d.autopilot;
  const month = d.attribution.periods[0];
  const quarter = d.attribution.periods[1];
  const gbp = d.google.find((g) => g.provider === "google_business");

  const needs: NeedsYouItem[] = [];
  if (d.reviews.held > 0) {
    needs.push({
      key: "reviews",
      text: `${d.reviews.held} Google review${d.reviews.held === 1 ? "" : "s"} of 3 stars or fewer waiting for your reply.`,
      open: { kind: "mkt.review_list", id: "held" },
      action: "Answer",
    });
  }
  for (const g of d.google.filter((x) => x.status === "error")) {
    needs.push({ key: `int-${g.provider}`, text: `${PROVIDER_LABEL[g.provider]} has a problem: ${g.lastError ?? "unknown"}.`, href: INTEGRATIONS_HREF, action: "Settings" });
  }
  if (d.social.scheduled > 0 && !d.social.facebookReady) {
    needs.push({ key: "fb", text: `${d.social.scheduled} post${d.social.scheduled === 1 ? "" : "s"} scheduled but no Facebook page is connected and ticked Posting.`, href: INTEGRATIONS_HREF, action: "Settings" });
  }
  for (const s of d.seasons) {
    if (s.open && !s.run && settings.seasonalMode === "owner") needs.push({ key: `season-${s.season}`, text: `The ${SEASON_INFO[s.season].label.toLowerCase()} window is open: preview and start the email below.` });
  }
  for (const l of quarter?.lines ?? []) {
    const target = l.channel ? CPL_TARGET[l.channel] : undefined;
    if (target && l.costPerLeadCents != null && l.costPerLeadCents > target) {
      needs.push({ key: `cpl-${l.channel}`, text: `${l.label} cost ${money(l.costPerLeadCents)} a lead over 90 days, above the ${money(target)} target.` });
    }
  }
  // The two outbound machines that were built and never started (hotspot #10).
  if (!d.outbound.pmSending) {
    needs.push({ key: "pm", text: `Property-manager outreach is switched off (${d.outbound.pmCompanies} companies found). HOA and commercial snow is sold outbound: switch it on with its ramp.`, open: { kind: "mkt.pm_list", id: "all" }, action: "Open" });
  }
  if (d.outbound.campaignsRunning === 0 && d.outbound.campaignsDraft > 0) {
    needs.push({ key: "campaigns", text: `${d.outbound.campaignsDraft} email campaign${d.outbound.campaignsDraft === 1 ? " is" : "s are"} still a draft and none is running.`, open: { kind: "mkt.campaign_list", id: "draft" }, action: "Open" });
  }
  if (quarter?.band === "over") needs.push({ key: "band", text: `Marketing spend is ${pct(quarter.spendShare, 1)} of revenue over 90 days, above the ${pct(settings.spendTargetHigh)} ceiling.` });

  const bandTone: Tone = !quarter || quarter.band == null ? "none" : quarter.band === "on" ? "good" : quarter.band === "over" ? "bad" : "warn";
  const cpl = month && month.spendCents > 0 && month.leads > 0 ? Math.round(month.spendCents / month.leads) : null;

  return (
    <div className="grid gap-4">
      <NeedsYou items={needs} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Leads, 30 days" value={String(month?.leads ?? 0)} />
        <Kpi label="Cost per lead, 30 days" value={money(cpl)} target="< $65 LSA, < $90 Search" />
        <Kpi
          label="Spend / revenue, 90 days"
          value={pct(quarter?.spendShare ?? null, 1)}
          target={`${pct(settings.spendTargetLow)}–${pct(settings.spendTargetHigh)}`}
          tone={bandTone}
        />
        <Kpi label="New Google reviews, 30 days" value={String(d.reviews.last30)} target="4–10 / month" tone={gbp?.status !== "connected" ? "none" : d.reviews.last30 >= 4 ? "good" : "warn"} />
        <Kpi
          label="Google rating"
          value={d.reviews.average != null ? d.reviews.average.toFixed(1) : "—"}
          target="≥ 4.7"
          tone={d.reviews.average == null ? "none" : d.reviews.average >= 4.7 ? "good" : "warn"}
        />
        <Kpi
          label="Reviews answered"
          value={pct(d.reviews.responseRate)}
          target="100%"
          tone={d.reviews.responseRate == null ? "none" : d.reviews.responseRate >= 0.99 ? "good" : "warn"}
        />
      </div>

      <Section title="Where the work came from" hint="Leads, sales and revenue by channel, with spend where it is known. Hangers and flyers are costed as their plays close.">
        <ChannelTable periods={d.attribution.periods} hasSpend={d.attribution.hasSpend} />
      </Section>

      <Section title="Google" hint="Business Profile reviews and insights, Search and Local Services ads, and the rank tracker. Pulled every morning.">
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {d.google.map((g) => (
            <li key={g.provider} className="flex min-h-11 items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
              <span className="font-semibold">{PROVIDER_LABEL[g.provider]}</span>
              <span className={g.status === "connected" ? "text-green-700 dark:text-green-400" : g.status === "error" ? "text-destructive" : "text-muted-foreground"}>
                {g.status === "not_connected" ? "Not connected — add it in Settings › Integrations" : statusText(g)}
              </span>
            </li>
          ))}
        </ul>
        {gbp?.status === "connected" ? (
          <div className="grid grid-cols-3 gap-2">
            <Kpi label="Calls from the listing, 30 days" value={String(d.insights.calls)} />
            <Kpi label="Direction requests" value={String(d.insights.directions)} />
            <Kpi label="Website clicks" value={String(d.insights.websiteClicks)} />
          </div>
        ) : null}
        <GoogleRunButton disabled={d.google.every((g) => g.status === "not_connected")} />
      </Section>

      <Section title="Spend not reported by an API" hint="Upload a CSV from Google Ads, LSA or Facebook Ads Manager, or add one amount. Reading the same day again replaces it.">
        <SpendForms />
      </Section>

      <Section
        title="Seasonal email to past clients"
        hint="Spring cleanup (Jan 15–Mar 31), aeration (Aug–Sep), snow pre-sell (Sep–Nov 15). One email per client per season, only to those who agreed to marketing email."
      >
        <div className="grid gap-2 md:grid-cols-3">
          {d.seasons.map((s) => (
            <SeasonCard key={s.season} season={s.season} open={s.open} run={s.run} />
          ))}
        </div>
        <SeasonalModeForm mode={settings.seasonalMode} goLive={settings.seasonalGoLive} />
      </Section>

      <Section title="What runs on its own" hint="Each switch remembers when it was first turned on and only acts on what came after.">
        <AutomationSwitches keys={DIGITAL_SWITCHES} settings={settings} started={started} />
        <p className="text-sm text-muted-foreground">
          Facebook: {d.social.facebookReady ? "a page is connected for posting" : "no page connected for posting"} · {d.social.scheduled} scheduled
          {d.social.autoMade ? ` (${d.social.autoMade} made from crew photos)` : ""}
          {d.social.overdue ? ` · ${d.social.overdue} past their slot` : ""}. Rank tracker: {d.rank.keywords} phrases, {d.rank.scannedThisWeek} checked this week.
        </p>
        <NumberSettings
          fields={[
            { key: "posts", label: "Facebook posts a week from crew photos", value: settings.socialPostsPerWeek, setting: "socialPostsPerWeek" },
            { key: "rank", label: "Rank phrases checked a week", value: settings.rankPerWeek, setting: "rankPerWeek" },
            { key: "low", label: "Spend target, low", value: settings.spendTargetLow * 100, suffix: "% of revenue", setting: "spendTargetLow", scale: 0.01 },
            { key: "high", label: "Spend target, high", value: settings.spendTargetHigh * 100, suffix: "% of revenue", setting: "spendTargetHigh", scale: 0.01 },
          ]}
        />
        <ListSettings towns={settings.rankTowns} services={settings.rankServices} />
      </Section>
    </div>
  );
}
