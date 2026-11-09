import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { isMissingTable } from "@/lib/setup-errors";
import { buildBoard, groupByPerson, isChannel, isLane, type BoardCard, type BoardMessage, type CardState, type ChannelId, type Person } from "@/lib/comms-board";
import { isIntent, type CardAction, type Question, type Resource } from "@/lib/comms-intents";

/**
 * The Communications Board's reads: every stored message from every feed,
 * turned into BoardMessage, grouped one card per person, with each card's
 * saved state from migration 0373 laid on top.
 *
 * What feeds it, and from where:
 *   Text        job_messages (Twilio SMS and GoHighLevel webhooks, sent_via sms or none)
 *   Email       job_messages (Resend inbound, sent_via / reference_kind email)
 *   Client page job_messages (written on their proposal page)
 *   Phone call  job_messages "Incoming call from" notes, and missed calls in voice_calls
 *   Facebook / Instagram DMs  meta_messages
 *   Google review             google_reviews, with our posted reply
 *   Website form              jobs.client_notes from the booking form
 *   Everything else           comms_manual_messages, added by hand (0373)
 *
 * Each read is bounded and newest first, like the inbox's own window.
 */

const WINDOW = 1500;

type Row = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" ? v : null);

async function read(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<{ rows: Row[]; missing: boolean }> {
  try {
    const { data, error } = await q;
    if (error) return { rows: [], missing: isMissingTable(error as { code?: string; message?: string }) };
    return { rows: (data ?? []) as Row[], missing: false };
  } catch {
    return { rows: [], missing: false };
  }
}

export async function db(): Promise<SupabaseClient> {
  return (await createClient()) as unknown as SupabaseClient;
}

interface Who {
  customerId: string;
  name: string;
  phone: string | null;
  email: string | null;
}

/** Customers behind some jobs, by job id. */
async function whoByJob(sb: SupabaseClient, jobIds: string[]): Promise<Map<string, Who>> {
  const out = new Map<string, Who>();
  if (!jobIds.length) return out;
  const jobs = (await read(sb.from("jobs").select("id, property_id").in("id", jobIds))).rows;
  const propIds = [...new Set(jobs.map((j) => String(j.property_id)))];
  const props = propIds.length ? (await read(sb.from("properties").select("id, customer_id").in("id", propIds))).rows : [];
  const custByProp = new Map(props.map((p) => [String(p.id), String(p.customer_id)]));
  const customers = await customersById(sb, [...new Set(props.map((p) => String(p.customer_id)))]);
  for (const j of jobs) {
    const c = customers.get(custByProp.get(String(j.property_id)) ?? "");
    if (c) out.set(String(j.id), c);
  }
  return out;
}

async function customersById(sb: SupabaseClient, ids: string[]): Promise<Map<string, Who>> {
  const out = new Map<string, Who>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const rows = (await read(sb.from("customers").select("id, name, phone, email").in("id", chunk))).rows;
    for (const c of rows) out.set(String(c.id), { customerId: String(c.id), name: s(c.name) ?? "", phone: s(c.phone), email: s(c.email) });
  }
  return out;
}

/** job_messages into board messages. Team-only notes are not part of a conversation with the client. */
export function fromJobMessage(m: Row, who: Who | undefined): BoardMessage | null {
  const author = s(m.author_type);
  const lane = s(m.channel);
  const body = s(m.body) ?? "";
  const via = s(m.sent_via);
  const kind = s(m.reference_kind);
  let channel: ChannelId;
  let direction: "in" | "out";
  if (author === "client") {
    direction = "in";
    if (lane === "internal") {
      if (!/^Incoming call from/i.test(body)) return null;
      channel = "call";
    } else if (via === "email" || kind === "email") channel = "email";
    else if (via === "sms" || !kind) channel = "sms";
    else channel = "app";
  } else {
    if (lane !== "external") return null;
    direction = "out";
    channel = via === "sms" ? "sms" : via === "email" ? "email" : "app";
  }
  return {
    id: `jm:${m.id}`,
    channel,
    direction,
    text: body,
    at: s(m.created_at) ?? "",
    name: direction === "in" ? who?.name || s(m.author_name) : who?.name,
    customerId: who?.customerId ?? null,
    phone: who?.phone ?? null,
    email: who?.email ?? null,
    jobId: s(m.job_id),
  };
}

export async function loadBoardMessages(sb: SupabaseClient): Promise<{ messages: BoardMessage[]; manualMissing: boolean }> {
  const since = new Date(Date.now() - 120 * 86_400_000).toISOString();
  const [jm, meta, reviews, calls, forms, manual] = await Promise.all([
    read(sb.from("job_messages").select("id, job_id, channel, author_type, author_name, body, created_at, sent_via, reference_kind").order("created_at", { ascending: false }).limit(WINDOW)),
    read(sb.from("meta_messages").select("id, page_row_id, platform, contact_id, contact_name, direction, body, attachments, created_at").order("created_at", { ascending: false }).limit(1000)),
    read(sb.from("google_reviews").select("id, author, stars, body, reviewed_at, reply_body, reply_posted_at").order("reviewed_at", { ascending: false }).limit(200)),
    read(sb.from("voice_calls").select("id, from_number, customer_id, job_id, duration_seconds, created_at").eq("direction", "inbound").eq("missed", true).order("created_at", { ascending: false }).limit(300)),
    read(sb.from("jobs").select("id, client_notes, created_at").not("client_notes", "is", null).gte("created_at", since).order("created_at", { ascending: false }).limit(300)),
    read(sb.from("comms_manual_messages").select("*").order("received_at", { ascending: false }).limit(500)),
  ]);

  const jobIds = [...new Set([...jm.rows.map((r) => String(r.job_id)), ...forms.rows.map((r) => String(r.id)), ...calls.rows.filter((r) => r.job_id).map((r) => String(r.job_id))])];
  const byJob = await whoByJob(sb, jobIds);
  const extraCustomerIds = [...calls.rows, ...manual.rows].map((r) => s(r.customer_id)).filter((x): x is string => Boolean(x));
  const byCustomer = await customersById(sb, [...new Set(extraCustomerIds)]);

  const messages: BoardMessage[] = [];
  for (const m of jm.rows) {
    const msg = fromJobMessage(m, byJob.get(String(m.job_id)));
    if (msg) messages.push(msg);
  }
  for (const m of meta.rows) {
    const ig = m.platform === "instagram";
    const text = s(m.body) ?? (Array.isArray(m.attachments) && m.attachments.length ? "(sent an attachment)" : "");
    messages.push({
      id: `meta:${m.id}`,
      channel: ig ? "ig_dm" : "fb_dm",
      direction: m.direction === "out" ? "out" : "in",
      text,
      at: s(m.created_at) ?? "",
      name: s(m.contact_name),
      handle: `${ig ? "ig" : "fb"}:${m.contact_id}`,
      ref: { pageRowId: String(m.page_row_id), platform: String(m.platform), contactId: String(m.contact_id) },
    });
  }
  for (const r of reviews.rows) {
    const at = s(r.reviewed_at) ?? "";
    const stars = Number(r.stars ?? 0);
    messages.push({
      id: `gr:${r.id}`,
      channel: "google",
      direction: "in",
      text: `${"★".repeat(Math.max(0, Math.min(5, stars)))} ${s(r.body) ?? ""}`.trim(),
      at,
      name: s(r.author),
      handle: `google:${r.id}`,
      ref: { reviewId: String(r.id) },
    });
    if (s(r.reply_body) && s(r.reply_posted_at)) {
      messages.push({ id: `grr:${r.id}`, channel: "google", direction: "out", text: s(r.reply_body) as string, at: s(r.reply_posted_at) as string, handle: `google:${r.id}`, ref: { reviewId: String(r.id) } });
    }
  }
  for (const c of calls.rows) {
    const who = (s(c.customer_id) ? byCustomer.get(String(c.customer_id)) : undefined) ?? (s(c.job_id) ? byJob.get(String(c.job_id)) : undefined);
    messages.push({
      id: `vc:${c.id}`,
      channel: "call",
      direction: "in",
      text: `Missed call${Number(c.duration_seconds) ? `, ${c.duration_seconds} seconds` : ""}.`,
      at: s(c.created_at) ?? "",
      name: who?.name ?? s(c.from_number),
      customerId: who?.customerId ?? null,
      phone: s(c.from_number) ?? who?.phone ?? null,
      email: who?.email ?? null,
      jobId: s(c.job_id),
    });
  }
  for (const j of forms.rows) {
    const who = byJob.get(String(j.id));
    messages.push({
      id: `form:${j.id}`,
      channel: "form",
      direction: "in",
      text: s(j.client_notes) ?? "",
      at: s(j.created_at) ?? "",
      name: who?.name,
      customerId: who?.customerId ?? null,
      phone: who?.phone ?? null,
      email: who?.email ?? null,
      jobId: String(j.id),
    });
  }
  for (const m of manual.rows) {
    const who = s(m.customer_id) ? byCustomer.get(String(m.customer_id)) : undefined;
    const channel = isChannel(m.channel) ? m.channel : "other";
    messages.push({
      id: `hand:${m.id}`,
      channel,
      direction: m.direction === "out" ? "out" : "in",
      text: s(m.body) ?? "",
      at: s(m.received_at) ?? "",
      name: who?.name ?? s(m.contact_name),
      customerId: who?.customerId ?? null,
      phone: s(m.contact_phone) ?? who?.phone ?? null,
      email: s(m.contact_email) ?? who?.email ?? null,
      handle: s(m.contact_handle),
    });
  }
  return { messages: messages.filter((m) => m.at), manualMissing: manual.missing };
}

// ---------------------------------------------------------------------------
// Card state (0373)
// ---------------------------------------------------------------------------

export function stateFromRow(r: Row): CardState {
  const sent = s(r.sent_at)
    ? {
        body: s(r.sent_body) ?? "",
        channel: (isChannel(r.sent_channel) ? r.sent_channel : "other") as ChannelId,
        at: s(r.sent_at) as string,
        byHand: Boolean(r.sent_by_hand),
        did: s(r.sent_did),
      }
    : null;
  return {
    personKey: String(r.person_key),
    lane: isLane(r.lane) ? r.lane : "backlog",
    intent: isIntent(r.intent) ? r.intent : null,
    intentSummary: s(r.intent_summary),
    resources: Array.isArray(r.resources) ? (r.resources as Resource[]) : [],
    action: (r.action as CardAction | null) ?? null,
    question: (r.question as Question | null) ?? null,
    answer: s(r.answer),
    draft: s(r.draft),
    draftChannel: isChannel(r.draft_channel) ? r.draft_channel : null,
    draftByHand: Boolean(r.draft_by_hand),
    basedOn: s(r.based_on),
    cancelledAt: s(r.cancelled_at),
    noReasons: Array.isArray(r.no_reasons) ? (r.no_reasons as { why: string; at: string }[]) : [],
    sent,
    followUpOn: s(r.follow_up_on),
    updatedAt: s(r.updated_at),
  };
}

export function rowFromState(state: CardState, organizationId: string, customerId: string | null, profileId: string): Row {
  return {
    organization_id: organizationId,
    person_key: state.personKey,
    customer_id: customerId,
    lane: state.lane,
    intent: state.intent ?? null,
    intent_summary: state.intentSummary ?? null,
    resources: state.resources ?? [],
    action: state.action ?? null,
    question: state.question ?? null,
    answer: state.answer ?? null,
    draft: state.draft ?? null,
    draft_channel: state.draftChannel ?? null,
    draft_by_hand: Boolean(state.draftByHand),
    based_on: state.basedOn ?? null,
    cancelled_at: state.cancelledAt ?? null,
    no_reasons: state.noReasons ?? [],
    sent_body: state.sent?.body ?? null,
    sent_channel: state.sent?.channel ?? null,
    sent_at: state.sent?.at ?? null,
    sent_by_hand: Boolean(state.sent?.byHand),
    sent_did: state.sent?.did ?? null,
    sent_by: state.sent ? profileId : null,
    follow_up_on: state.followUpOn ?? null,
    updated_by: profileId,
    updated_at: state.updatedAt ?? new Date().toISOString(),
  };
}

export async function loadCardStates(sb: SupabaseClient): Promise<{ states: CardState[]; missing: boolean }> {
  const { rows, missing } = await read(sb.from("comms_board_cards").select("*").limit(5000));
  return { states: rows.map(stateFromRow), missing };
}

export interface BoardLoad {
  cards: BoardCard[];
  /** comms_board_cards is not there: lanes are worked out, nothing is saved. */
  needsMigration: boolean;
}

export async function loadBoard(): Promise<BoardLoad> {
  const sb = await db();
  const [{ messages, manualMissing }, { states, missing }] = await Promise.all([loadBoardMessages(sb), loadCardStates(sb)]);
  return { cards: buildBoard(groupByPerson(messages), states), needsMigration: missing || manualMissing };
}

/** One person, freshly read, for the checks at the moment of Yes. */
export async function loadPerson(personKey: string): Promise<{ person: Person | null; state: CardState | null; missing: boolean }> {
  const sb = await db();
  const [{ messages }, { states, missing }] = await Promise.all([loadBoardMessages(sb), loadCardStates(sb)]);
  const person = groupByPerson(messages).find((p) => p.key === personKey || keysMatch(p, personKey)) ?? null;
  return { person, state: states.find((x) => x.personKey === personKey) ?? null, missing };
}

/** A card saved under a phone key still finds the person once a customer row joins them. */
function keysMatch(p: Person, key: string): boolean {
  const [kind, value] = [key.slice(0, 2), key.slice(2)];
  if (kind === "c:") return p.customerId === value;
  if (kind === "p:") return p.phones.some((x) => x.replace(/\D/g, "").endsWith(value));
  if (kind === "e:") return p.emails.some((x) => x.toLowerCase() === value);
  if (kind === "h:") return p.handles.includes(value);
  return false;
}
