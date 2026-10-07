/**
 * Research one opportunity end-to-end without a database: attachments,
 * comparable past awards (price anchor), and candidate local subs.
 *
 *   npx tsx scripts/govcon-research.ts candidates.json [noticeId]
 *
 * Uses GOOGLE_PLACES_API_KEY for local sub search when set.
 */
import { readFileSync } from "node:fs";

import { listAttachments, rankAttachments } from "../src/lib/govcon/sources/sam-attachments";
import { anchorFromComparables, findComparableAwards } from "../src/lib/govcon/sources/usaspending";
import { findSubCandidates } from "../src/lib/govcon/subfinder";
import { TRADE_BY_KEY } from "../src/lib/govcon/trades";
import type { Opportunity, OpportunityScore } from "../src/lib/govcon/types";

async function main() {
  const [file, noticeId] = process.argv.slice(2);
  const all = JSON.parse(readFileSync(file, "utf8")) as Array<Opportunity & { score: OpportunityScore }>;
  const opp = noticeId ? all.find((o) => o.externalId === noticeId) : all.find((o) => o.score.recommendation === "bid");
  if (!opp) throw new Error("opportunity not found");
  console.log(`# ${opp.title}\n${opp.url}\n${opp.placeOfPerformance.city}, ${opp.placeOfPerformance.state} — due ${opp.responseDeadline}`);

  const atts = rankAttachments(await listAttachments(opp.externalId));
  console.log("\nAttachments (ranked):");
  for (const a of atts) console.log(`  ${a.name} (${a.size ?? "?"} bytes)`);

  const comps = await findComparableAwards(opp);
  console.log("\nComparable awards:");
  for (const c of comps.slice(0, 6)) {
    console.log(`  [${c.similarity}] ${c.awardId} ${c.recipientName} $${Math.round(c.amount).toLocaleString()} (${c.startDate} → ${c.endDate}) ≈ $${Math.round(c.annualAmount).toLocaleString()}/yr — ${c.description.slice(0, 60)}`);
  }
  console.log("Anchor:", anchorFromComparables(comps));

  const trade = TRADE_BY_KEY[opp.score.trade!];
  const subs = await findSubCandidates({ opp, trade, placesApiKey: process.env.GOOGLE_PLACES_API_KEY });
  console.log(`\nSub candidates (${trade.label}):`);
  for (const s of subs) console.log(`  [${s.rank}] ${s.name} | ${s.phone ?? "-"} | ${s.email ?? "-"} | ${s.website ?? "-"} | fed $${s.pastFederalAmount ?? 0}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
