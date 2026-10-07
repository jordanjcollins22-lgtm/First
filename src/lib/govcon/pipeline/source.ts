import { randomBytes } from "node:crypto";

import { findSubCandidates, normalizeBusinessName, type RegistryEntity } from "../subfinder";
import { TRADE_BY_KEY } from "../trades";
import type { TradeKey } from "../types";
import { logEvent, rowToOpp, timeLeft, type PipelineContext } from "./context";

/**
 * Stage 3 — find local subs near the place of performance and queue a quote
 * request (RFQ) for each. Subs with an email get an automated RFQ; phone-only
 * subs go on the call list. Quotes are due 3 days before the government
 * deadline so there's time to price and write the proposal.
 */
const RFQS_PER_OPPORTUNITY = 8;
const QUOTE_BUFFER_DAYS = 3;

export function quoteDueAt(responseDeadline: string | null, now: Date): string {
  const minDue = now.getTime() + 2 * 86_400_000;
  if (!responseDeadline) return new Date(now.getTime() + 5 * 86_400_000).toISOString();
  const due = Date.parse(responseDeadline) - QUOTE_BUFFER_DAYS * 86_400_000;
  // Never ask for a quote sooner than 2 days out or after the deadline itself.
  return new Date(Math.min(Math.max(due, minDue), Date.parse(responseDeadline) - 86_400_000)).toISOString();
}

export async function source(ctx: PipelineContext, limit = 5) {
  const stats = { opportunities: 0, subsFound: 0, rfqsCreated: 0, noSubs: 0 };
  const { data: rows, error } = await ctx.db
    .from("govcon_opportunities")
    .select("*")
    .eq("status", "sourcing")
    .order("response_deadline", { ascending: true })
    .limit(limit);
  if (error) throw error;

  for (const row of rows ?? []) {
    if (timeLeft(ctx) < 60_000) break;
    stats.opportunities++;
    const trade = row.trade ? TRADE_BY_KEY[row.trade as TradeKey] : null;
    if (!trade) continue;
    const opp = rowToOpp(row);

    const registry = await registryNear(ctx, opp.placeOfPerformance.state, opp.placeOfPerformance.zip, [
      ...(opp.naicsCode ? [opp.naicsCode] : []),
      ...trade.naicsCodes,
    ]);
    const candidates = await findSubCandidates({
      opp,
      trade,
      placesApiKey: ctx.keys.places,
      maxCandidates: RFQS_PER_OPPORTUNITY + 4,
      registry,
    }).catch(async (e) => {
      await logEvent(ctx, row.id, "error", `Sub search failed: ${(e as Error).message}`);
      return [];
    });

    if (!candidates.length) {
      stats.noSubs++;
      await ctx.db
        .from("govcon_opportunities")
        .update({ last_error: ctx.keys.places ? "No local subs found" : "No local subs found — set GOOGLE_PLACES_API_KEY to search local businesses" })
        .eq("id", row.id);
      continue;
    }
    stats.subsFound += candidates.length;

    // Upsert subs; skip anyone marked do-not-contact.
    const subIds: Array<{ id: string; hasEmail: boolean }> = [];
    for (const c of candidates) {
      const dedupeKey = `${normalizeBusinessName(c.name)}:${(c.state ?? opp.placeOfPerformance.state ?? "").toUpperCase()}`;
      const { data: existing } = await ctx.db
        .from("govcon_subcontractors")
        .select("id, email, trades, do_not_contact")
        .eq("dedupe_key", dedupeKey)
        .maybeSingle();
      if (existing?.do_not_contact) continue;
      if (existing) {
        await ctx.db
          .from("govcon_subcontractors")
          .update({
            email: existing.email ?? c.email,
            phone: c.phone,
            website: c.website,
            rating: c.rating,
            review_count: c.reviewCount,
            trades: Array.from(new Set([...(existing.trades ?? []), trade.key])),
          })
          .eq("id", existing.id);
        subIds.push({ id: existing.id, hasEmail: Boolean(existing.email ?? c.email) });
      } else {
        const { data: inserted, error: insErr } = await ctx.db
          .from("govcon_subcontractors")
          .insert({
            dedupe_key: dedupeKey,
            name: c.name,
            email: c.email,
            phone: c.phone,
            website: c.website,
            address: c.address,
            city: c.city,
            state: c.state ?? opp.placeOfPerformance.state ?? null,
            zip: c.zip,
            rating: c.rating,
            review_count: c.reviewCount,
            place_id: c.placeId,
            uei: c.uei,
            past_federal_amount: c.pastFederalAmount,
            is_small_business: c.samSmall,
            trades: [trade.key],
            source: c.source,
          })
          .select("id")
          .single();
        if (insErr) throw insErr;
        subIds.push({ id: inserted.id, hasEmail: Boolean(c.email) });
      }
      if (subIds.length >= RFQS_PER_OPPORTUNITY) break;
    }

    const due = quoteDueAt(row.response_deadline, ctx.now);
    const rfqs = subIds.map((s) => ({
      opportunity_id: row.id,
      subcontractor_id: s.id,
      token: randomBytes(18).toString("base64url"),
      channel: s.hasEmail ? ("email" as const) : ("call" as const),
      status: "queued" as const,
      quote_due_at: due,
    }));
    const { error: rfqErr } = await ctx.db
      .from("govcon_rfqs")
      .upsert(rfqs, { onConflict: "opportunity_id,subcontractor_id", ignoreDuplicates: true });
    if (rfqErr) throw rfqErr;
    stats.rfqsCreated += rfqs.length;

    await ctx.db.from("govcon_opportunities").update({ status: "awaiting_quotes", last_error: null }).eq("id", row.id);
    const emailCount = rfqs.filter((r) => r.channel === "email").length;
    await logEvent(
      ctx,
      row.id,
      "sourced",
      `Found ${candidates.length} local ${trade.label.toLowerCase()} subs; queued ${emailCount} email RFQs and ${rfqs.length - emailCount} calls (quotes due ${due.slice(0, 10)})`
    );
  }
  return stats;
}

/**
 * SAM-registered firms in these NAICS near the job: same 3-digit zip first,
 * then statewide. Empty until the monthly entity import has run.
 */
async function registryNear(
  ctx: PipelineContext,
  state: string | null | undefined,
  zip: string | null | undefined,
  naics: string[]
): Promise<RegistryEntity[]> {
  if (!state || !naics.length) return [];
  const cols = "uei, legal_name, dba_name, address, city, state, zip5, website, small_naics";
  const base = () =>
    ctx.db.from("govcon_sam_entities").select(cols).eq("state", state).overlaps("naics", naics).not("website", "is", null);
  const out: RegistryEntity[] = [];
  if (zip) {
    const { data } = await base().like("zip5", `${zip.slice(0, 3)}%`).limit(15);
    out.push(...((data ?? []) as RegistryEntity[]));
  }
  if (out.length < 8) {
    const { data } = await base().limit(15 - out.length);
    for (const e of (data ?? []) as RegistryEntity[]) if (!out.some((o) => o.uei === e.uei)) out.push(e);
  }
  return out;
}
