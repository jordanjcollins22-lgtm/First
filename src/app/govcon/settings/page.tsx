import { connection } from "next/server";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveGovconSettings } from "@/lib/actions/govcon-actions";
import { getSettings } from "@/lib/data/govcon";
import { TRADES } from "@/lib/govcon/trades";

const CERTS = [
  ["small_business", "Small business (SAM size representation)"],
  ["8a", "8(a)"],
  ["hubzone", "HUBZone"],
  ["sdvosb", "Service-disabled veteran-owned (VetCert)"],
  ["vosb", "Veteran-owned (VetCert)"],
  ["wosb", "Women-owned (WOSB)"],
  ["edwosb", "Economically disadvantaged WOSB"],
] as const;

const KEYS = [
  ["SAM_API_KEY", "Optional — same-day SAM.gov notices (the keyless daily file is used otherwise)"],
  ["ANTHROPIC_API_KEY", "Reads solicitations, writes sub scopes, checks quotes, drafts proposals"],
  ["GOOGLE_PLACES_API_KEY", "Finds local subs near each job site"],
  ["RESEND_API_KEY", "Sends quote requests and your daily digest (plus GOVCON_FROM_EMAIL)"],
  ["CRON_SECRET", "Protects the cron endpoint"],
] as const;

function Field({ label, name, defaultValue, hint, type = "text" }: { label: string; name: string; defaultValue?: string | number | null; hint?: string; type?: string }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} defaultValue={defaultValue ?? ""} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default async function GovconSettingsPage() {
  await connection();
  const { profile, company, state } = await getSettings();
  return (
    <form action={saveGovconSettings} className="flex max-w-3xl flex-col gap-5">
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="text-sm text-muted-foreground">
        Everything has a working default — the pipeline runs without touching this page. Fill in company details so
        proposals and quote requests carry your info.
      </p>

      <Card>
        <CardHeader><CardTitle className="text-base">Company</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="Company name" name="companyName" defaultValue={company.name ?? profile.companyName} />
          <Field label="Contact name" name="contactName" defaultValue={company.contactName} />
          <Field label="UEI (SAM.gov)" name="uei" defaultValue={company.uei} />
          <Field label="CAGE code" name="cage" defaultValue={company.cage} />
          <Field label="Email (digest + replies)" name="email" defaultValue={company.email} />
          <Field label="Phone" name="phone" defaultValue={company.phone} />
          <div className="sm:col-span-2"><Field label="Address" name="address" defaultValue={company.address} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Certifications (decides which set-asides we can bid)</CardTitle></CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 text-sm">
          {CERTS.map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <input type="checkbox" name={`cert_${key}`} defaultChecked={profile.certifications.includes(key)} /> {label}
            </label>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Bidding rules</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field label="Target markup %" name="targetMarkup" type="number" defaultValue={Math.round(profile.targetMarkup * 100)} hint="Added to the winning sub quote" />
          <Field label="Minimum markup %" name="minMarkup" type="number" defaultValue={Math.round(profile.minMarkup * 100)} hint="Floor when trimming to beat past award prices" />
          <Field label="Minimum days to respond" name="minDaysToRespond" type="number" defaultValue={profile.minDaysToRespond} hint="Skip bids due sooner — not enough time for sub quotes" />
          <Field label="Max contract value $" name="maxEstimatedValue" type="number" defaultValue={profile.maxEstimatedValue} />
          <Field label="Monthly proposal target" name="monthlyProposalTarget" type="number" defaultValue={profile.monthlyProposalTarget} />
          <Field label="States (blank = all)" name="states" defaultValue={profile.states.join(", ")} hint="e.g. NC, SC, VA" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Trades to broker (none checked = all)</CardTitle></CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-3 text-sm">
          {TRADES.map((t) => (
            <label key={t.key} className="flex items-center gap-2">
              <input type="checkbox" name="trades" value={t.key} defaultChecked={profile.trades.includes(t.key)} /> {t.label}
            </label>
          ))}
        </CardContent>
      </Card>

      <Button type="submit" className="self-start">Save settings</Button>

      <Card>
        <CardHeader><CardTitle className="text-base">Integrations (environment variables)</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          {KEYS.map(([key, why]) => (
            <p key={key}>
              <span className={process.env[key] ? "text-primary" : "text-destructive"}>{process.env[key] ? "✓" : "✗"}</span>{" "}
              <code>{key}</code> — {why}
            </p>
          ))}
          {typeof state.csvProcessedAt === "string" && (
            <p className="text-muted-foreground">SAM.gov daily file last processed {new Date(state.csvProcessedAt).toLocaleString()}</p>
          )}
        </CardContent>
      </Card>
    </form>
  );
}
