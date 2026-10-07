import Link from "next/link";
import { connection } from "next/server";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ActionButton, CopyButton } from "@/components/govcon/action-button";
import { markRfq, markSubDoNotContact, setSubEmailForRfq } from "@/lib/actions/govcon-actions";
import { getCallList, getSettings } from "@/lib/data/govcon";
import type { SolicitationAnalysis } from "@/lib/govcon/ai";
import { appUrl } from "@/lib/govcon/pipeline/context";
import { callScript, formatDate } from "@/lib/govcon/templates";
import { TRADE_BY_KEY } from "@/lib/govcon/trades";
import type { TradeKey } from "@/lib/govcon/types";

/**
 * Subs we found with a phone number but no email. One call each: confirm
 * they do commercial work, get an email, and the system takes it from there.
 */
export default async function CallListPage() {
  await connection();
  const [calls, settings] = await Promise.all([getCallList(), getSettings()]);
  const company = {
    name: settings.company.name ?? settings.profile.companyName,
    uei: null,
    cage: null,
    address: null,
    contactName: settings.company.contactName ?? null,
    email: null,
    phone: null,
  };
  const base = appUrl();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Call list</h1>
        <p className="text-sm text-muted-foreground">
          Local subs with no email on their website. Call, get an email address, and the quote request goes out automatically —
          or text them the quote link.
        </p>
      </div>
      {!calls.length && <p className="text-muted-foreground">Nobody to call right now.</p>}
      {calls.map(({ rfq, sub, opp }) => {
        const analysis = (opp.analysis ?? {}) as Partial<SolicitationAnalysis>;
        const trade = opp.trade ? TRADE_BY_KEY[opp.trade as TradeKey] : null;
        const location = [opp.pop_city, opp.pop_state].filter(Boolean).join(", ");
        return (
          <Card key={rfq.id}>
            <CardContent className="space-y-3 pt-5 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-lg font-semibold">{sub.name}</p>
                  <p>
                    {sub.phone ? <a href={`tel:${sub.phone}`} className="font-medium text-primary underline">{sub.phone}</a> : "No phone"}
                    {sub.website && <> · <a href={sub.website} target="_blank" rel="noreferrer" className="underline">website</a></>}
                    {sub.rating ? ` · ★ ${sub.rating} (${sub.review_count ?? 0})` : ""}
                  </p>
                  <p className="text-muted-foreground">
                    For <Link href={`/govcon/opportunities/${opp.id}`} className="underline">{opp.title}</Link> · quotes due {formatDate(rfq.quote_due_at)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <CopyButton text={`${base}/quote/${rfq.token}`} label="Copy quote link" />
                  <ActionButton size="sm" variant="outline" action={markRfq.bind(null, rfq.id, "called")}>Called</ActionButton>
                  <ActionButton size="sm" variant="ghost" action={markSubDoNotContact.bind(null, sub.id)} confirmText="Never contact this company again?">
                    Do not contact
                  </ActionButton>
                </div>
              </div>
              <p className="rounded-md bg-muted p-3 italic">
                {callScript({ company, tradeLabel: trade?.label ?? "facility services", location, scopeSummary: (analysis.scopeSummary ?? opp.title).slice(0, 300) })}
              </p>
              <form action={setSubEmailForRfq.bind(null, rfq.id)} className="flex gap-2">
                <Input name="email" type="email" placeholder="Email they gave you" required className="max-w-xs" />
                <Button type="submit" size="sm">Send quote request</Button>
              </form>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
