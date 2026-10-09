import { after, NextResponse, type NextRequest } from "next/server";

import { isSupabaseAdminConfigured } from "@/lib/env";
import { appSecretFor, pageForAccount, storeMetaMessage, verifyTokenKnown } from "@/lib/data/meta";
import { createAdminClient } from "@/lib/supabase/admin";
import { messagesIn, signatureOk } from "@/lib/meta/webhook";
import { notifyTeamMember } from "@/lib/notifications";
import { log } from "@/lib/log";

/**
 * Where Meta delivers Messenger and Instagram messages for every connected page.
 *
 * GET is Meta checking the address: it sends back the challenge only when the
 * verify token is one a business here was given. POST is a delivery: each
 * message is matched to its page, the delivery's signature is checked with
 * that business's own app secret, and the message is kept. The person who
 * connected Facebook gets a text for each new one.
 *
 * Meta wants a 200 quickly and retries anything else, so a delivery for a page
 * nobody here connected is answered 200 and dropped.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const token = params.get("hub.verify_token") ?? "";
  if (params.get("hub.mode") === "subscribe" && isSupabaseAdminConfigured && (await verifyTokenKnown(token))) {
    return new NextResponse(params.get("hub.challenge") ?? "", { status: 200, headers: { "content-type": "text/plain" } });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(request: NextRequest) {
  if (!isSupabaseAdminConfigured) return NextResponse.json({ ok: false }, { status: 503 });
  const raw = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const messages = messagesIn(body);
  const checked = new Map<string, boolean>();
  let kept = 0;

  for (const message of messages) {
    const page = await pageForAccount(message.accountId);
    if (!page) continue;

    if (!checked.has(page.organizationId)) {
      const secret = await appSecretFor(page.organizationId);
      checked.set(page.organizationId, Boolean(secret && signatureOk(raw, signature, secret)));
    }
    if (!checked.get(page.organizationId)) {
      log.warn("meta.webhook.bad_signature", { accountId: message.accountId });
      return NextResponse.json({ ok: false }, { status: 403 });
    }

    try {
      const { isNew, contactName } = await storeMetaMessage(page, message);
      if (!isNew) continue;
      kept += 1;
      if (message.direction === "in") {
        const who = contactName ?? "Someone";
        const where = message.platform === "instagram" ? "Instagram" : "Facebook";
        const text = message.text ?? (message.attachments.length ? "(sent an attachment)" : "");
        after(() => alertOwner(page.organizationId, `${who} on ${where}: ${text}`.slice(0, 300), message.mid));
      }
    } catch (err) {
      log.error("meta.webhook.store_failed", err, { accountId: message.accountId });
    }
  }

  return NextResponse.json({ ok: true, kept });
}

async function alertOwner(organizationId: string, line: string, mid: string): Promise<void> {
  const { data } = await createAdminClient().from("meta_settings").select("connected_by").eq("organization_id", organizationId).maybeSingle();
  if (!data?.connected_by) return;
  await notifyTeamMember(data.connected_by, "client_messages", `${line}\nReply in Admin → Facebook & Instagram.`, {
    dedupeKey: `meta:${mid}`,
  }).catch((err) => log.error("meta.webhook.alert_failed", err));
}
