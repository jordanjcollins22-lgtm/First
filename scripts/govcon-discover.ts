/**
 * Dry-run discovery: stream the SAM.gov daily CSV (or a local copy), score
 * every notice for the broker model, and print the top bid candidates.
 * No database or API keys needed.
 *
 *   npx tsx scripts/govcon-discover.ts [path/to/ContractOpportunitiesFullCSV.csv] [--json out.json]
 */
import { createReadStream, writeFileSync } from "node:fs";
import { Readable } from "node:stream";

import { latestByKey } from "../src/lib/govcon/normalize";
import { DEFAULT_PROFILE } from "../src/lib/govcon/profile";
import { scoreOpportunity } from "../src/lib/govcon/scoring";
import { streamSamCsv } from "../src/lib/govcon/sources/sam-csv";
import type { Opportunity } from "../src/lib/govcon/types";

async function main() {
  const args = process.argv.slice(2);
  const jsonIdx = args.indexOf("--json");
  const jsonOut = jsonIdx >= 0 ? args[jsonIdx + 1] : null;
  const file = args.find((a, i) => !a.startsWith("--") && i !== jsonIdx + 1);

  const now = new Date();
  const kept: Array<{ opp: Opportunity; score: ReturnType<typeof scoreOpportunity> }> = [];
  const counts = { total: 0, tradeMatch: 0, bid: 0, maybe: 0, no_bid: 0 };
  const disq: Record<string, number> = {};

  const result = await streamSamCsv({
    body: file
      ? (Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>)
      : undefined,
    onOpportunity: (opp) => {
      counts.total++;
      const score = scoreOpportunity(opp, DEFAULT_PROFILE, { now });
      if (!score.trade) return;
      counts.tradeMatch++;
      counts[score.recommendation]++;
      for (const d of score.disqualifiers) {
        const key = d.replace(/\$[\d,]+|\d+ days|[A-Z]{2} is/g, "#");
        disq[key] = (disq[key] ?? 0) + 1;
      }
      if (score.recommendation !== "no_bid") kept.push({ opp, score });
    },
  });

  const latest = new Set(latestByKey(kept.map((k) => k.opp)).map((o) => o.externalId));
  const before = kept.length;
  kept.splice(0, kept.length, ...kept.filter((k) => latest.has(k.opp.externalId)));
  console.log(`Deduped amendments: ${before} -> ${kept.length}`);
  kept.sort((a, b) => b.score.total - a.score.total);
  console.log(`Rows: ${result.rows}`, counts);
  console.log("Top disqualifiers:", Object.entries(disq).sort((a, b) => b[1] - a[1]).slice(0, 10));
  const byTrade: Record<string, number> = {};
  for (const k of kept) if (k.score.recommendation === "bid") byTrade[k.score.trade!] = (byTrade[k.score.trade!] ?? 0) + 1;
  console.log("Bid candidates by trade:", byTrade);
  for (const { opp, score } of kept.slice(0, 40)) {
    console.log(
      `${score.total} ${score.recommendation.padEnd(5)} ${score.trade?.padEnd(16)} ${opp.placeOfPerformance.state ?? "??"} ` +
        `due ${opp.responseDeadline?.slice(0, 10) ?? "n/a"} | ${opp.title.slice(0, 80)} | ${opp.url}`
    );
  }
  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify(kept.map(({ opp, score }) => ({ ...opp, description: opp.description?.slice(0, 2000), score })), null, 2));
    console.log(`Wrote ${kept.length} candidates to ${jsonOut}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
