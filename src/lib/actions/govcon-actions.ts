"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { GOVCON_AUTH_COOKIE, dashboardToken, isGovconAuthorized } from "@/lib/govcon/auth";
import { runPipeline, type Stage } from "@/lib/govcon/pipeline";
import { priceBid, type PriceAnchor } from "@/lib/govcon/pricing";
import type { SetAside, TradeKey } from "@/lib/govcon/types";
import { normalizeBusinessName } from "@/lib/govcon/subfinder";
import { createAdminClient } from "@/lib/supabase/admin";

/** Server actions are callable directly, so each one re-checks the gate. */
async function requireAuth() {
  const jar = await cookies();
  if (!isGovconAuthorized(jar.get(GOVCON_AUTH_COOKIE)?.value)) throw new Error("Not authorized");
}

async function event(opportunityId: string | null, kind: string, message: string) {
  await createAdminClient().from("govcon_events").insert({ opportunity_id: opportunityId, kind, message });
}

export async function govconLogin(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/govcon");
  const expected = process.env.GOVCON_DASHBOARD_PASSWORD;
  if (!expected || password !== expected) redirect(`/govcon/login?error=1&next=${encodeURIComponent(next)}`);
  const jar = await cookies();
  jar.set(GOVCON_AUTH_COOKIE, dashboardToken(expected), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect(next.startsWith("/govcon") ? next : "/govcon");
}

export async function runStageNow(stage: Stage) {
  await requireAuth();
  const result = await runPipeline(stage, 240_000);
  revalidatePath("/govcon");
  return result;
}

export async function setOpportunityStatus(
  id: string,
  status: "new" | "no_bid" | "submitted" | "won" | "lost",
  reason?: string
) {
  await requireAuth();
  const db = createAdminClient();
  await db.from("govcon_opportunities").update({ status, status_reason: reason ?? null }).eq("id", id);
  if (status === "submitted") {
    await db.from("govcon_bids").update({ status: "submitted", submitted_at: new Date().toISOString() }).eq("opportunity_id", id);
  } else if (status === "won" || status === "lost") {
    await db.from("govcon_bids").update({ status }).eq("opportunity_id", id);
  }
  await event(id, status, `Marked ${status.replace("_", "-")} by user${reason ? `: ${reason}` : ""}`);
  revalidatePath(`/govcon/opportunities/${id}`);
  revalidatePath("/govcon");
}

/** Quote taken over the phone: create the sub + RFQ + quote in one go. */
export async function addManualQuote(opportunityId: string, formData: FormData) {
  await requireAuth();
  const db = createAdminClient();
  const name = String(formData.get("name") ?? "").trim();
  const amount = Number(String(formData.get("amount") ?? "").replace(/[$,]/g, ""));
  if (!name || !(amount > 0)) throw new Error("Sub name and a positive amount are required");
  const { data: opp } = await db.from("govcon_opportunities").select("pop_state, trade").eq("id", opportunityId).single();
  const dedupeKey = `${normalizeBusinessName(name)}:${(opp?.pop_state ?? "").toUpperCase()}`;
  const { data: sub, error: subErr } = await db
    .from("govcon_subcontractors")
    .upsert(
      {
        dedupe_key: dedupeKey,
        name,
        email: String(formData.get("email") ?? "").trim() || null,
        phone: String(formData.get("phone") ?? "").trim() || null,
        state: opp?.pop_state ?? null,
        trades: opp?.trade ? [opp.trade] : [],
        source: "manual",
      },
      { onConflict: "dedupe_key" }
    )
    .select("id")
    .single();
  if (subErr) throw subErr;
  const { data: rfq, error: rfqErr } = await db
    .from("govcon_rfqs")
    .upsert(
      { opportunity_id: opportunityId, subcontractor_id: sub.id, token: randomBytes(18).toString("base64url"), channel: "call", status: "quoted" },
      { onConflict: "opportunity_id,subcontractor_id" }
    )
    .select("id")
    .single();
  if (rfqErr) throw rfqErr;
  await db.from("govcon_rfqs").update({ status: "quoted" }).eq("id", rfq.id);
  await db.from("govcon_quotes").insert({
    rfq_id: rfq.id,
    opportunity_id: opportunityId,
    subcontractor_id: sub.id,
    amount,
    notes: String(formData.get("notes") ?? "") || null,
    accepts_net30: formData.get("net30") === "on",
    uses_own_employees: formData.get("own_employees") === "on",
    is_small_business: formData.get("small_business") === "on",
    references_text: String(formData.get("references") ?? "") || null,
  });
  await event(opportunityId, "quote", `Phone quote logged: ${name} $${amount.toLocaleString()}`);
  revalidatePath(`/govcon/opportunities/${opportunityId}`);
}

/** Got an email address on a call: switch the RFQ to automated email. */
export async function setSubEmailForRfq(rfqId: string, formData: FormData) {
  await requireAuth();
  const email = String(formData.get("email") ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Enter a valid email");
  const db = createAdminClient();
  const { data: rfq } = await db.from("govcon_rfqs").select("subcontractor_id, opportunity_id").eq("id", rfqId).single();
  if (!rfq) return;
  await db.from("govcon_subcontractors").update({ email }).eq("id", rfq.subcontractor_id);
  await db.from("govcon_rfqs").update({ channel: "email", status: "queued" }).eq("id", rfqId);
  revalidatePath("/govcon/calls");
  revalidatePath(`/govcon/opportunities/${rfq.opportunity_id}`);
}

export async function markRfq(rfqId: string, status: "called" | "declined") {
  await requireAuth();
  await createAdminClient().from("govcon_rfqs").update({ status }).eq("id", rfqId);
  revalidatePath("/govcon/calls");
}

export async function markSubDoNotContact(subId: string) {
  await requireAuth();
  const db = createAdminClient();
  await db.from("govcon_subcontractors").update({ do_not_contact: true }).eq("id", subId);
  await db.from("govcon_rfqs").update({ status: "declined" }).eq("subcontractor_id", subId).in("status", ["queued", "sent", "viewed"]);
  revalidatePath("/govcon/calls");
}

export async function repriceBid(opportunityId: string, formData: FormData) {
  await requireAuth();
  const markup = Number(formData.get("markup")) / 100;
  if (!(markup >= 0 && markup < 3)) throw new Error("Markup must be between 0 and 300%");
  const db = createAdminClient();
  const { data: bid } = await db.from("govcon_bids").select("*").eq("opportunity_id", opportunityId).single();
  const { data: opp } = await db.from("govcon_opportunities").select("price_anchor").eq("id", opportunityId).single();
  if (!bid) return;
  const pricing = priceBid({ subQuote: bid.sub_cost, targetMarkup: markup, minMarkup: Math.min(markup, 0.05), anchor: null });
  await db
    .from("govcon_bids")
    .update({ price: pricing.price, markup: pricing.markup, pricing: { ...pricing, manual: true, anchor: (opp?.price_anchor ?? null) as PriceAnchor | null } })
    .eq("opportunity_id", opportunityId);
  await event(opportunityId, "repriced", `Repriced at ${Math.round(markup * 100)}% markup → $${pricing.price.toLocaleString()}`);
  revalidatePath(`/govcon/opportunities/${opportunityId}`);
}

const CERTS: SetAside[] = ["small_business", "8a", "hubzone", "sdvosb", "vosb", "wosb", "edwosb"];

export async function saveGovconSettings(formData: FormData) {
  await requireAuth();
  const num = (k: string, fallback: number) => {
    const v = Number(formData.get(k));
    return Number.isFinite(v) && String(formData.get(k) ?? "") !== "" ? v : fallback;
  };
  const list = (k: string) =>
    String(formData.get(k) ?? "")
      .split(/[\s,]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  const profile = {
    companyName: String(formData.get("companyName") ?? "").trim() || undefined,
    certifications: CERTS.filter((c) => formData.get(`cert_${c}`) === "on"),
    states: list("states"),
    trades: formData.getAll("trades").map(String) as TradeKey[],
    targetMarkup: num("targetMarkup", 25) / 100,
    minMarkup: num("minMarkup", 12) / 100,
    minDaysToRespond: num("minDaysToRespond", 5),
    maxEstimatedValue: num("maxEstimatedValue", 1_500_000),
    monthlyProposalTarget: num("monthlyProposalTarget", 25),
  };
  const company = {
    name: profile.companyName,
    uei: String(formData.get("uei") ?? "").trim() || null,
    cage: String(formData.get("cage") ?? "").trim() || null,
    address: String(formData.get("address") ?? "").trim() || null,
    contactName: String(formData.get("contactName") ?? "").trim() || null,
    email: String(formData.get("email") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
  };
  await createAdminClient().from("govcon_settings").upsert({ id: 1, profile, company });
  revalidatePath("/govcon");
  revalidatePath("/govcon/settings");
}
