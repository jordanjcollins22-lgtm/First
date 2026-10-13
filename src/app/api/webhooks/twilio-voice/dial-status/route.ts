import Twilio from "twilio";
import { after, NextResponse, type NextRequest } from "next/server";

import { env, isTwilioConfigured } from "@/lib/env";
import { log } from "@/lib/log";
import { outboundBaseUrl } from "@/lib/base-url";
import { recordDialResult } from "@/lib/data/voice-calls";

const xml = (body: string) =>
  new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, { status: 200, headers: { "Content-Type": "text/xml" } });

/**
 * Where Twilio reports how a <Dial> ended: the action URL on the inbound
 * route's Dial and on click-to-call's. It carries DialCallStatus (completed,
 * no-answer, busy, failed, canceled) and DialCallDuration.
 *
 * The call is written down and acted on (text-back, call log) after the
 * response, so the caller is never kept waiting on a database. A missed call
 * in still gets the voicemail it always got.
 *
 * Query: dir=in|out, job=<job id> (out), p=<profile id> (who rang or was rung).
 */
export async function POST(request: NextRequest) {
  if (!isTwilioConfigured) return xml("");

  const form = await request.formData();
  const params: Record<string, string> = {};
  form.forEach((value, key) => {
    params[key] = String(value);
  });

  // Twilio signs the whole address it called, query string included.
  const signature = request.headers.get("x-twilio-signature") ?? "";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const host = request.headers.get("host") ?? "";
  const url = `${proto}://${host}${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (!Twilio.validateRequest(env.twilioAuthToken, signature, url, params)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const direction = request.nextUrl.searchParams.get("dir") === "out" ? "outbound" : "inbound";
  const status = params.DialCallStatus ?? "";
  const duration = Number(params.DialCallDuration ?? 0) || 0;
  const origin = (await outboundBaseUrl().catch(() => "")) || request.nextUrl.origin;

  // The caller, on the way in. On the way out the parent call is to our own
  // team member, so the client is found from the job instead.
  const clientNumber = direction === "inbound" ? params.From ?? "" : "";
  const businessNumber = direction === "inbound" ? params.To ?? null : env.twilioPhoneNumber || null;
  const missedIn = direction === "inbound" && status !== "completed" && status !== "answered";

  after(() =>
    recordDialResult({
      callSid: params.CallSid ?? `${Date.now()}`,
      direction,
      clientNumber,
      businessNumber,
      dialStatus: status,
      durationSeconds: duration,
      jobId: request.nextUrl.searchParams.get("job"),
      profileId: request.nextUrl.searchParams.get("p"),
      origin,
    }).then(
      () => undefined,
      (err) => log.error("twilio_voice.dial_status", err, { status })
    )
  );

  if (missedIn) {
    return xml(
      "<Say>Sorry we missed you. Please leave a message after the tone and we will call you back.</Say><Record maxLength=\"120\" />"
    );
  }
  return xml("");
}
