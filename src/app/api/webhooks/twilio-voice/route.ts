import Twilio from "twilio";
import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { last10Digits, toE164 } from "@/lib/sms";
import { qualifiesForAffiliateLink } from "@/lib/affiliate-roles";
import { env, isTwilioConfigured } from "@/lib/env";

function dialResponse(numbers: string[]): NextResponse {
  const dials = numbers.map((n) => `<Number>${n}</Number>`).join("");
  const twiml =
    numbers.length > 0
      ? `<?xml version="1.0" encoding="UTF-8"?><Response><Dial callerId="${env.twilioPhoneNumber}">${dials}</Dial></Response>`
      : `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, no one is available to take your call right now. Please leave a message after the tone.</Say><Record maxLength="120" /></Response>`;
  return new NextResponse(twiml, { status: 200, headers: { "Content-Type": "text/xml" } });
}

/**
 * Twilio's inbound-call webhook — set this URL (https://yourdomain/api/webhooks/twilio-voice)
 * as the number's "A call comes in" webhook in the Twilio console.
 *
 * Routes to the evaluator/AM assigned to the caller's most recent job if
 * their phone is on file; otherwise rings every evaluator/account manager
 * with a phone on file simultaneously (first to answer gets it).
 */
export async function POST(request: NextRequest) {
  if (!isTwilioConfigured) {
    return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response><Say>This line is not set up yet.</Say></Response>', {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  }

  const formData = await request.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => {
    params[key] = String(value);
  });

  const signature = request.headers.get("x-twilio-signature") ?? "";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const host = request.headers.get("host") ?? "";
  const url = `${proto}://${host}${request.nextUrl.pathname}`;

  const isValid = Twilio.validateRequest(env.twilioAuthToken, signature, url, params);
  if (!isValid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const from = params.From ?? "";
  const admin = createAdminClient();

  let assignedProfileId: string | null = null;
  if (from) {
    const senderDigits = last10Digits(from);
    const { data: customers } = await admin
      .from("customers")
      .select("id, name, phone, organization_id")
      .not("phone", "is", null);
    const customer = (customers ?? []).find((c) => c.phone && last10Digits(c.phone) === senderDigits);

    if (customer) {
      const { data: properties } = await admin.from("properties").select("id").eq("customer_id", customer.id);
      const propertyIds = (properties ?? []).map((p) => p.id);
      if (propertyIds.length > 0) {
        const { data: jobs } = await admin
          .from("jobs")
          .select("id, assigned_to")
          .in("property_id", propertyIds)
          .order("created_at", { ascending: false })
          .limit(1);
        const job = jobs?.[0];
        assignedProfileId = job?.assigned_to ?? null;

        if (job) {
          await admin.from("job_messages").insert({
            job_id: job.id,
            organization_id: customer.organization_id,
            channel: "internal",
            author_type: "client",
            author_name: customer.name,
            body: `Incoming call from ${customer.name} (${from}).`,
          });
        }
      }
    }
  }

  if (assignedProfileId) {
    const { data: assignedProfile } = await admin.from("profiles").select("phone").eq("id", assignedProfileId).maybeSingle();
    const e164 = assignedProfile?.phone ? toE164(assignedProfile.phone) : null;
    if (e164) return dialResponse([e164]);
  }

  // No specific match (or they have no phone on file) — ring the whole sales team.
  const { data: profiles } = await admin.from("profiles").select("id, phone").not("phone", "is", null);
  const { data: roleRows } = await admin.from("profile_roles").select("profile_id, role_name");
  const rolesByProfile = new Map<string, string[]>();
  for (const r of roleRows ?? []) {
    const list = rolesByProfile.get(r.profile_id) ?? [];
    list.push(r.role_name);
    rolesByProfile.set(r.profile_id, list);
  }
  const teamNumbers = (profiles ?? [])
    .filter((p) => p.phone && qualifiesForAffiliateLink(rolesByProfile.get(p.id) ?? []))
    .map((p) => toE164(p.phone as string))
    .filter((n): n is string => n !== null);

  return dialResponse(teamNumbers);
}
