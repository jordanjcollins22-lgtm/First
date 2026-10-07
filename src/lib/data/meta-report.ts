import { createAdminClient } from "@/lib/supabase/admin";
import { outboundBaseUrl } from "@/lib/base-url";
import { log } from "@/lib/log";
import { fbcFromClickId, metaEndpoint, metaEvent, type MetaEventInput } from "@/lib/meta-capi";
import type { AdClick } from "@/lib/ad-click";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * One event to Meta's Conversions API. Off, and false, until the pixel id and
 * token are set; never throws, because a sale or a booking must not wait on
 * Meta or fail with it.
 */
export async function reportToMeta(input: MetaEventInput): Promise<boolean> {
  const endpoint = metaEndpoint(process.env.META_PIXEL_ID, process.env.META_CAPI_TOKEN);
  if (!endpoint) return false;
  try {
    const testCode = process.env.META_TEST_EVENT_CODE;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: [metaEvent(input)], ...(testCode ? { test_event_code: testCode } : {}) }),
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) log.warn("meta.rejected", { status: response.status, event: input.name });
    return response.ok;
  } catch (err) {
    log.warn("meta.failed", { event: input.name, error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

function absolute(base: string, path: string): string {
  return `${base.replace(/\/$/, "")}${path}`;
}

/**
 * A booking from the booking page: the ad click it came from kept with the
 * job, and the booking told to Meta as a Lead so the ads learn who books.
 */
export async function recordBookingAdClick(
  admin: Admin,
  input: { jobId: string; organizationId: string; click: AdClick | null; email: string; phone: string; ip: string | null; userAgent: string | null }
): Promise<void> {
  const click = input.click;
  const fbc = fbcFromClickId(click?.fbclid, new Date());
  if (click) {
    const { error } = await admin.from("job_ad_clicks").upsert({
      job_id: input.jobId,
      organization_id: input.organizationId,
      fbc,
      fbp: click.fbp ?? null,
      gclid: click.gclid ?? null,
      gbraid: click.gbraid ?? null,
      wbraid: click.wbraid ?? null,
      utm_source: click.utm_source ?? null,
      utm_medium: click.utm_medium ?? null,
      utm_campaign: click.utm_campaign ?? null,
      client_ip: input.ip,
      client_user_agent: input.userAgent,
    });
    if (error) log.warn("booking.ad_click_failed", { jobId: input.jobId, error: error.message });
  }

  const base = (await outboundBaseUrl()) || "";
  const sent = await reportToMeta({
    name: "Lead",
    eventId: `${input.jobId}:lead`,
    at: new Date(),
    sourceUrl: absolute(base, "/book"),
    email: input.email,
    phone: input.phone,
    fbc,
    fbp: click?.fbp ?? null,
    ip: input.ip,
    userAgent: input.userAgent,
  });
  if (sent && click) await admin.from("job_ad_clicks").update({ meta_lead_reported_at: new Date().toISOString() }).eq("job_id", input.jobId);
}

/**
 * A signed proposal, told to Meta as a Purchase with its price, once. This is
 * the event the ads should learn from: not who fills in a form, who buys.
 */
export async function reportSaleToMeta(admin: Admin, jobId: string, valueCents: number): Promise<void> {
  if (!metaEndpoint(process.env.META_PIXEL_ID, process.env.META_CAPI_TOKEN)) return;

  const [{ data: job }, { data: click }] = await Promise.all([
    admin.from("jobs").select("id, properties(customers(organization_id, email, phone))").eq("id", jobId).maybeSingle(),
    admin.from("job_ad_clicks").select("fbc, fbp, client_ip, client_user_agent, meta_purchase_reported_at").eq("job_id", jobId).maybeSingle(),
  ]);
  if (click?.meta_purchase_reported_at) return;
  const customer = (job as unknown as { properties: { customers: { organization_id: string; email: string | null; phone: string | null } | null } | null } | null)?.properties?.customers;
  if (!customer || (!customer.email && !customer.phone)) return;

  const base = (await outboundBaseUrl()) || "";
  const sent = await reportToMeta({
    name: "Purchase",
    eventId: `${jobId}:purchase`,
    at: new Date(),
    sourceUrl: absolute(base, "/proposal"),
    email: customer.email ?? "",
    phone: customer.phone ?? "",
    fbc: click?.fbc ?? null,
    fbp: click?.fbp ?? null,
    ip: click?.client_ip ?? null,
    userAgent: click?.client_user_agent ?? null,
    valueCents,
  });
  if (!sent) return;
  await admin
    .from("job_ad_clicks")
    .upsert({ job_id: jobId, organization_id: customer.organization_id, meta_purchase_reported_at: new Date().toISOString() });
}
