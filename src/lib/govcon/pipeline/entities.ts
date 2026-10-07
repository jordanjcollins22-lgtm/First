import { latestSamEntityFile, samEntityDownloadUrl, streamSamEntities, type SamEntity } from "../sources/sam-entities";
import { logEvent, saveSettingsState, type PipelineContext } from "./context";

/**
 * Monthly — refresh govcon_sam_entities from SAM's public entity extract
 * (~150 MB zip → ~124k firms in our trades, ~15 s to parse). Skips when the
 * latest file was already imported.
 */
export async function importEntities(ctx: PipelineContext) {
  const name = await latestSamEntityFile();
  if (ctx.settingsState.samEntityFile === name) return { skipped: true, file: name };
  const res = await fetch(samEntityDownloadUrl(name));
  if (!res.ok || !res.body) throw new Error(`SAM entity download failed: HTTP ${res.status}`);
  const d = name.match(/(\d{8})/)![1];
  const extractDate = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

  let batch: SamEntity[] = [];
  let written = 0;
  const flush = async () => {
    if (!batch.length) return;
    const rows = batch.map((e) => ({ ...e, extract_date: extractDate }));
    batch = [];
    const { error } = await ctx.db.from("govcon_sam_entities").upsert(rows, { onConflict: "uei" });
    if (error) throw error;
    written += rows.length;
  };
  const result = await streamSamEntities(res.body, async (e) => {
    batch.push(e);
    if (batch.length >= 1000) await flush();
  });
  await flush();

  const cutoff = new Date(Date.parse(extractDate) - 62 * 86_400_000).toISOString().slice(0, 10);
  await ctx.db.from("govcon_sam_entities").delete().lt("extract_date", cutoff);
  await saveSettingsState(ctx, { samEntityFile: name, samEntityImportedAt: new Date().toISOString() });
  await logEvent(ctx, null, "entities", `Imported ${written.toLocaleString()} SAM-registered firms in our trades from ${name}`);
  return { skipped: false, file: name, records: result.records, written };
}
