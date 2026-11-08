"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

import { makeAdDrafts } from "@/lib/data/ad-drafts";
import { getRealProfile } from "@/lib/data/team";
import { env } from "@/lib/env";
import { adsAccountFrom, mutate } from "@/lib/google/ads";
import { googleAccessToken } from "@/lib/google/oauth";
import { getIntegration } from "@/lib/integrations/store";
import { BUDGET_STEPS_CENTS, launchOperations, type Estimate } from "@/lib/marketing/ad-draft";
import { isOwnerLevel } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Approving or skipping an ad made from a job photo. Owner only, checked
 * against the account actually signed in. Approve launches it live in Google
 * Ads with the budget the owner was shown; that is the only place in the app
 * that spends money in Google Ads.
 */

export type Result<T = null> = { ok: true; value: T } | { ok: false; error: string };

const BOOKING_FALLBACK = "https://app.jslandscapingmd.com";

async function owner() {
  const me = await getRealProfile();
  if (!me) throw new Error("Not signed in.");
  if (!isOwnerLevel(me.roles)) throw new Error("Only an owner can do that.");
  return me;
}

async function guard<T>(name: string, work: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (err) {
    console.error(`[ad-drafts] ${name} failed:`, err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const service = () => createAdminClient() as unknown as SupabaseClient;

export async function launchAdDraft(id: string, dailyBudgetCents: number, estimate: Estimate): Promise<Result<string>> {
  return guard("launchAdDraft", async () => {
    const me = await owner();
    if (!(BUDGET_STEPS_CENTS as readonly number[]).includes(dailyBudgetCents)) throw new Error("Pick one of the budgets shown.");
    const sb = service();
    const { data: draft } = await sb
      .from("ad_drafts")
      .select("id, name, headlines, descriptions, keywords, zip, status, job_photos(path)")
      .eq("id", id)
      .eq("organization_id", me.organization_id)
      .maybeSingle();
    const d = draft as unknown as {
      id: string;
      name: string;
      headlines: string[];
      descriptions: string[];
      keywords: string[];
      zip: string | null;
      status: string;
      job_photos: { path: string } | null;
    } | null;
    if (!d) throw new Error("That ad is gone.");
    if (d.status !== "draft") throw new Error("That ad was already decided.");
    if (!d.job_photos?.path) throw new Error("The photo for this ad was deleted.");

    const row = await getIntegration(me.organization_id, "google_ads");
    if (!row || row.status === "not_connected") throw new Error("Connect Google Ads in Settings › Integrations first.");
    const auth = await googleAccessToken(row.secrets);
    if (!auth.ok) throw new Error(auth.error);
    const account = adsAccountFrom(row.secrets);
    if (!account.ok) throw new Error(account.error);

    const { data: file, error: fileError } = await sb.storage.from("job-photos").download(d.job_photos.path);
    if (fileError || !file) throw new Error("Couldn't read the photo.");
    const imageBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");

    const sent = await mutate(
      auth.token,
      account.value,
      launchOperations({
        customerId: account.value.customerId,
        name: d.name,
        dailyBudgetCents,
        copy: { headlines: d.headlines, descriptions: d.descriptions },
        keywords: d.keywords,
        finalUrl: `${(env.appUrl || BOOKING_FALLBACK).replace(/\/+$/, "")}/book`,
        imageBase64,
        zip: d.zip,
        radiusMiles: 10,
      })
    );
    const decided = { daily_budget_cents: dailyBudgetCents, estimate, decided_by: me.id, decided_at: new Date().toISOString() };
    if (!sent.ok) {
      await sb.from("ad_drafts").update({ ...decided, status: "failed", error: sent.error }).eq("id", d.id);
      throw new Error(`Google Ads said no: ${sent.error}`);
    }
    const campaign = sent.value.find((n) => n.includes("/campaigns/")) ?? null;
    await sb.from("ad_drafts").update({ ...decided, status: "launched", google_campaign: campaign, error: null }).eq("id", d.id);
    revalidatePath("/marketing");
    return `Live in Google Ads at $${dailyBudgetCents / 100} a day.`;
  });
}

/** The owner says no to an ad, and why, so the reason stays with it. */
export async function skipAdDraft(id: string, reason: string): Promise<Result> {
  return guard("skipAdDraft", async () => {
    const why = reason.trim().slice(0, 500);
    if (!why) throw new Error("Say why not, so the next ads can avoid it.");
    const me = await owner();
    await service()
      .from("ad_drafts")
      .update({ status: "skipped", no_reason: why, decided_by: me.id, decided_at: new Date().toISOString() })
      .eq("id", id)
      .eq("organization_id", me.organization_id)
      .eq("status", "draft");
    revalidatePath("/marketing");
    return null;
  });
}

/** Makes drafts now instead of waiting for the daily run. */
export async function makeAdDraftsNow(): Promise<Result<number>> {
  return guard("makeAdDraftsNow", async () => {
    const me = await owner();
    const made = await makeAdDrafts(createAdminClient(), me.organization_id);
    revalidatePath("/marketing");
    return made;
  });
}
