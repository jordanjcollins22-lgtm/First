/**
 * Monthly import of the SAM.gov public entity extract into
 * govcon_sam_entities (only active US firms in our trades' NAICS codes).
 * Runs from GitHub Actions on a schedule (.github/workflows/govcon-sam-entities.yml)
 * or by hand:
 *
 *   npx tsx scripts/govcon-import-sam-entities.ts               # download latest + import
 *   npx tsx scripts/govcon-import-sam-entities.ts file.ZIP      # local file
 *   npx tsx scripts/govcon-import-sam-entities.ts file.ZIP --dry-run
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (not for --dry-run).
 */
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

import { createClient } from "@supabase/supabase-js";

import { latestSamEntityFile, samEntityDownloadUrl, streamSamEntities, type SamEntity } from "../src/lib/govcon/sources/sam-entities";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const file = args.find((a) => !a.startsWith("--"));

  let body: ReadableStream<Uint8Array>;
  let extractDate: string;
  if (file) {
    body = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
    extractDate = file.match(/(\d{8})/)?.[1] ?? new Date().toISOString().slice(0, 10).replace(/-/g, "");
  } else {
    const name = await latestSamEntityFile();
    console.log(`Downloading ${name}`);
    const res = await fetch(samEntityDownloadUrl(name));
    if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
    body = res.body;
    extractDate = name.match(/(\d{8})/)![1];
  }
  const date = `${extractDate.slice(0, 4)}-${extractDate.slice(4, 6)}-${extractDate.slice(6, 8)}`;

  const db = dryRun
    ? null
    : createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const byState: Record<string, number> = {};
  let batch: SamEntity[] = [];
  const flush = async () => {
    if (!batch.length || !db) return void (batch = []);
    const rows = batch.map((e) => ({ ...e, extract_date: date }));
    batch = [];
    const { error } = await db.from("govcon_sam_entities").upsert(rows, { onConflict: "uei" });
    if (error) throw error;
  };

  const t = Date.now();
  const result = await streamSamEntities(body, async (e) => {
    byState[e.state ?? "??"] = (byState[e.state ?? "??"] ?? 0) + 1;
    batch.push(e);
    if (batch.length >= 1000) await flush();
  });
  await flush();
  console.log(`Scanned ${result.records.toLocaleString()} records → ${result.matched.toLocaleString()} target-trade entities in ${Math.round((Date.now() - t) / 1000)}s`);
  console.log("Top states:", Object.entries(byState).sort((a, b) => b[1] - a[1]).slice(0, 10));

  if (db) {
    // Drop firms that fell out of the extract (expired/inactive) after 2 months.
    const cutoff = new Date(Date.parse(date) - 62 * 86_400_000).toISOString().slice(0, 10);
    const { error } = await db.from("govcon_sam_entities").delete().lt("extract_date", cutoff);
    if (error) throw error;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
