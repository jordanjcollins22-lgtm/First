"use server";

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

import { env, isAnthropicConfigured } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/team";
import { listRolePermissions } from "@/lib/data/permissions";
import { tabsAllowedForRoles } from "@/lib/permissions";
import { isMissingTable } from "@/lib/setup-errors";
import { db, loadPerson, rowFromState } from "@/lib/data/comms-board";
import { loadPersonRaw } from "@/lib/data/comms-person";
import { factsFrom, type PersonRaw } from "@/lib/comms-person";
import {
  applyNo,
  applySent,
  canSend,
  CHANNELS,
  isChannel,
  noWhy,
  replyChannel,
  replyCheck,
  SEND_REFUSALS,
  type CardState,
  type ChannelId,
  type Person,
} from "@/lib/comms-board";
import {
  breakdownSchema,
  dollarsIn,
  factsText,
  keywordIntent,
  parseHint,
  resolveIntent,
  zoneNamed,
  type IntentHint,
  type PersonFacts,
} from "@/lib/comms-intents";
import { contextBlock, parseSuggestions, safeSuggestions, systemPrompt, type NudgeContext } from "@/lib/suggested-replies";
import { sendClientMessageVia } from "@/lib/actions/job-message-actions";
import { sendMetaReply } from "@/lib/actions/meta-actions";
import { approveReviewReply } from "@/lib/actions/marketing-autopilot-actions";
import { updateProposalDraft } from "@/lib/actions/proposal-actions";
import { trimSentProposal } from "@/lib/actions/proposal-trim-actions";
import { acceptSuggestion } from "@/lib/actions/schedule-engine-actions";
import type { ProposalZoneSnapshot } from "@/types/domain";

/**
 * The Communications Board's actions.
 *
 * Open to whoever can open the Conversations inbox, the same as answering a
 * text. Nothing here sends anything except decideYes, and decideYes sends
 * only through the paths the inbox already uses: a job's thread for text,
 * email and the client page, Admin > Facebook & Instagram's reply for DMs,
 * and the Google review reply. Every Yes re-reads the person's messages
 * first: a new message from them cancels it, and a reply somebody already
 * sent stops it, so nobody gets a double text.
 */

export type BoardResult<T = undefined> = { ok: true; value: T; saved: boolean } | { ok: false; error: string };

const MIGRATION_NOTE = "Needs update 0373 to save the board.";

async function viewer() {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Sign in again.");
  const permissions = await listRolePermissions().catch(() => []);
  if (!tabsAllowedForRoles(profile.roles, permissions).has("conversations")) throw new Error("You don't have Conversations.");
  return profile;
}

function fail(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
}

/** Saved when the table is there; the board works without it. */
async function save(sb: SupabaseClient, state: CardState, person: Person | null, org: string, profileId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const { error } = await sb
    .from("comms_board_cards")
    .upsert(rowFromState({ ...state, updatedAt: state.updatedAt ?? now }, org, person?.customerId ?? null, profileId), { onConflict: "organization_id,person_key" });
  if (error && !isMissingTable(error)) throw new Error(error.message);
  revalidatePath("/conversations/board");
  return !error;
}

async function fresh(personKey: string) {
  const profile = await viewer();
  const { person, state } = await loadPerson(personKey);
  if (!person) throw new Error("That person isn't on the board any more.");
  return { profile, person, state: state ?? { personKey, lane: "backlog" as const, noReasons: [] } };
}

const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Everything about one person, for their card and its sections. */
export async function loadPersonRecord(input: { customerId: string | null; jobIds: string[] }): Promise<BoardResult<PersonRaw>> {
  try {
    await viewer();
    const raw = await loadPersonRaw({ customerId: input.customerId, jobIds: input.jobIds.slice(0, 20) });
    return { ok: true, value: raw, saved: true };
  } catch (err) {
    return fail(err);
  }
}

/** Contacts by name, phone or email, for Add a message. */
export async function findContacts(query: string): Promise<BoardResult<{ id: string; name: string; phone: string | null; email: string | null }[]>> {
  try {
    await viewer();
    const q = query.trim().replace(/[%,()]/g, "");
    if (q.length < 2) return { ok: true, value: [], saved: true };
    const sb = await db();
    const { data } = await sb.from("customers").select("id, name, phone, email").or(`name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`).limit(8);
    return { ok: true, value: (data ?? []) as { id: string; name: string; phone: string | null; email: string | null }[], saved: true };
  } catch (err) {
    return fail(err);
  }
}

// ---------------------------------------------------------------------------
// Moving cards
// ---------------------------------------------------------------------------

/** Backlog to Breakdown: Claude starts on it. */
export async function startCard(personKey: string): Promise<BoardResult<CardState>> {
  try {
    const { profile, person, state } = await fresh(personKey);
    const next: CardState = { ...state, lane: "breakdown", updatedAt: new Date().toISOString() };
    const saved = await save(await db(), next, person, profile.organization_id, profile.id);
    return { ok: true, value: next, saved };
  } catch (err) {
    return fail(err);
  }
}

/** Park it in Answer · Track: waiting on them, with a follow-up day if there is one. */
export async function parkCard(personKey: string, followUpOn: string | null): Promise<BoardResult<CardState>> {
  try {
    const { profile, person, state } = await fresh(personKey);
    const next: CardState = { ...state, lane: "track", followUpOn: followUpOn && /^\d{4}-\d{2}-\d{2}$/.test(followUpOn) ? followUpOn : null, updatedAt: new Date().toISOString() };
    const saved = await save(await db(), next, person, profile.organization_id, profile.id);
    return { ok: true, value: next, saved };
  } catch (err) {
    return fail(err);
  }
}

// ---------------------------------------------------------------------------
// Breakdown: the intent, the resources, the action, or a question for Jordan
// ---------------------------------------------------------------------------

function said(person: Person): string[] {
  const check = replyCheck(person.messages);
  const unread = check.unread.length ? check.unread : person.messages.filter((m) => m.direction === "in").slice(-3);
  return unread.map((m) => m.text);
}

function transcript(person: Person): string {
  return person.messages
    .slice(-25)
    .map((m) => `${m.direction === "in" ? "Them" : "Us"} (${CHANNELS[m.channel].label}, ${m.at.slice(0, 16).replace("T", " ")}): ${m.text}`)
    .join("\n");
}

async function hintFor(person: Person, facts: PersonFacts, state: CardState): Promise<IntentHint> {
  const words = said(person);
  const lastIn = [...person.messages].reverse().find((m) => m.direction === "in");
  const zones = facts.proposal?.zones.map((z) => z.name) ?? [];
  const fallback = (): IntentHint => {
    const intent = keywordIntent(words, lastIn?.channel);
    const text = words.join(" ");
    return {
      intent,
      summary: "",
      zoneName: facts.proposal ? zoneNamed(text, facts.proposal.zones)?.name ?? null : null,
      change: /\b(remove|drop|take (it )?(off|out)|skip|without)\b/i.test(text) ? "remove" : dollarsIn(text) ? "price" : null,
      newPriceCents: dollarsIn(text),
      slotDate: null,
    };
  };
  if (!isAnthropicConfigured) return fallback();
  try {
    const client = new Anthropic({ apiKey: env.anthropicApiKey });
    const response = await client.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 2000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low", format: { type: "json_schema", schema: breakdownSchema(zones) } },
      system:
        "You read every message one person sent a landscaping business, across text, email, calls, social media and the website, and say what they want so the owner can answer it. Read every message, oldest first. Only name a price they asked for or the owner gave. Only pick an open day from the list given.",
      messages: [
        {
          role: "user",
          content: [
            factsText(facts),
            "",
            "Every message, oldest first:",
            transcript(person),
            state.answer ? `\nThe owner answered your question: ${state.answer}` : "",
            state.noReasons?.length ? `\nThe owner said no to earlier drafts because: ${state.noReasons.map((n) => n.why).join("; ")}` : "",
          ].join("\n"),
        },
      ],
    });
    if (response.stop_reason === "refusal") return fallback();
    const raw = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return parseHint(raw, zones, facts.slots.map((s) => s.date)) ?? fallback();
  } catch {
    return fallback();
  }
}

/**
 * Works out what they want and what Jordan needs to see. Lands in Answer ·
 * Doing ready to draft, in Answer · Track when it already has a reply or
 * needs Jordan to answer a question first.
 */
export async function breakdownCard(personKey: string): Promise<BoardResult<CardState>> {
  try {
    const { profile, person, state } = await fresh(personKey);
    const sb = await db();
    const check = replyCheck(person.messages);
    const basedOn = check.lastIn?.at ?? null;
    if (check.alreadyReplied) {
      const next: CardState = { ...state, lane: "track", draft: null, basedOn, updatedAt: new Date().toISOString() };
      return { ok: true, value: next, saved: await save(sb, next, person, profile.organization_id, profile.id) };
    }
    const raw = await loadPersonRaw({ customerId: person.customerId, jobIds: person.jobIds, withSlots: true });
    const facts = factsFrom(raw, person.name, today());
    const hint = await hintFor(person, facts, state);
    const answerHint = state.answer ? { ...hint, newPriceCents: dollarsIn(state.answer) ?? hint.newPriceCents } : hint;
    const b = resolveIntent({ facts, hint: answerHint, said: said(person), answer: state.answer, today: today() });
    const next: CardState = {
      ...state,
      lane: b.question ? "track" : "doing",
      intent: b.intent,
      intentSummary: b.summary,
      resources: b.resources,
      action: b.action,
      question: b.question,
      draft: null,
      basedOn,
      cancelledAt: null,
      updatedAt: new Date().toISOString(),
    };
    return { ok: true, value: next, saved: await save(sb, next, person, profile.organization_id, profile.id) };
  } catch (err) {
    return fail(err);
  }
}

/** Jordan's answer to the card's question: back to Breakdown to recommend with it. */
export async function answerQuestion(personKey: string, answer: string): Promise<BoardResult<CardState>> {
  try {
    const text = answer.trim().slice(0, 500);
    if (!text) return { ok: false, error: "Pick an answer or type one." };
    const { profile, person, state } = await fresh(personKey);
    const next: CardState = { ...state, lane: "breakdown", answer: text, question: null, updatedAt: new Date().toISOString() };
    return { ok: true, value: next, saved: await save(await db(), next, person, profile.organization_id, profile.id) };
  } catch (err) {
    return fail(err);
  }
}

// ---------------------------------------------------------------------------
// Answer · Doing: the words
// ---------------------------------------------------------------------------

/**
 * Claude's draft, written from every message and the breakdown, with every
 * No's why. Uses the same rules and price guard as Suggest a reply in the
 * inbox (lib/suggested-replies.ts).
 */
export async function draftCard(personKey: string): Promise<BoardResult<CardState>> {
  try {
    const { profile, person, state } = await fresh(personKey);
    const sb = await db();
    const check = replyCheck(person.messages);
    if (check.alreadyReplied) {
      const next: CardState = { ...state, lane: "track", draft: null, updatedAt: new Date().toISOString() };
      return { ok: true, value: next, saved: await save(sb, next, person, profile.organization_id, profile.id) };
    }
    if (!state.intent || !state.action || (check.lastIn && state.basedOn && check.lastIn.at > state.basedOn)) {
      // Nothing broken down yet, or they wrote again: Breakdown first.
      return breakdownCard(personKey);
    }
    const raw = await loadPersonRaw({ customerId: person.customerId, jobIds: person.jobIds });
    const facts = factsFrom(raw, person.name, today());
    const ruleMessage = resolveIntent({
      facts: { ...facts, slots: state.action.kind === "book" ? [{ date: state.action.date, crewNames: state.action.crewNames, crewProfileIds: state.action.crewProfileIds, because: state.action.because }] : facts.slots },
      hint: { intent: state.intent, summary: state.intentSummary ?? "" },
      said: said(person),
      answer: state.answer,
      today: today(),
    }).message;

    let draft = ruleMessage;
    if (state.action.kind !== "no_reply" && isAnthropicConfigured) {
      draft = (await modelDraft(person, facts, state, ruleMessage)) ?? ruleMessage;
    }
    const where = replyChannel(person);
    const next: CardState = {
      ...state,
      lane: "doing",
      draft,
      draftChannel: where.channel,
      draftByHand: where.byHand,
      updatedAt: new Date().toISOString(),
    };
    return { ok: true, value: next, saved: await save(sb, next, person, profile.organization_id, profile.id) };
  } catch (err) {
    return fail(err);
  }
}

async function modelDraft(person: Person, facts: PersonFacts, state: CardState, ruleMessage: string): Promise<string | null> {
  try {
    const context: NudgeContext = {
      customerName: person.name,
      propertyAddress: facts.address ?? "",
      stage: facts.jobStatus ?? "new contact",
      dueNext: state.action?.label ?? null,
      proposalStatus: facts.proposal?.status ?? null,
      proposalTotalCents: facts.proposal?.totalCents ?? null,
      proposalActivity: null,
      paid: Boolean(facts.proposal?.paidAt),
      startDate: null,
      recentMessages: person.messages.slice(-20).map((m) => ({ from: m.direction === "in" ? "client" : "team", body: `(${CHANNELS[m.channel].label}) ${m.text}`, at: m.at })),
    };
    const brief = [
      contextBlock(context, new Date()),
      "",
      factsText(facts),
      "",
      `What they want: ${state.intentSummary ?? state.intent}`,
      `What the office decided to do: ${state.action?.label}. The message goes with that decision, so state it plainly.`,
      `A plain version to improve on: ${ruleMessage}`,
      state.answer ? `The owner's call on this: ${state.answer}` : "",
      state.noReasons?.length ? `The owner turned down earlier drafts. Fix all of these: ${state.noReasons.map((n) => n.why).join("; ")}` : "",
      "Answer everything in all of their unanswered messages at once, in one message.",
    ].join("\n");
    // The office has already decided the day when the action is a booking, so the "never promise a date" rule gives way.
    const system = systemPrompt()
      .split("\n")
      .filter((line) => state.action?.kind !== "book" || !line.startsWith("- Never promise a date"))
      .join("\n");
    const client = new Anthropic({ apiKey: env.anthropicApiKey });
    const response = await client.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 2000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system,
      messages: [{ role: "user", content: brief }],
    });
    if (response.stop_reason === "refusal") return null;
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return safeSuggestions(parseSuggestions(text), `${brief}\n${state.action?.label ?? ""}`)[0] ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Validate · Doing: Yes or No
// ---------------------------------------------------------------------------

/** No, with a why: back to Answer · Doing, and the redraft reads the why. */
export async function decideNo(personKey: string, picked: string[], typed: string): Promise<BoardResult<CardState>> {
  try {
    const why = noWhy(picked, typed);
    if ("error" in why) return { ok: false, error: why.error };
    const { profile, person, state } = await fresh(personKey);
    const next = applyNo(state, why.why, new Date().toISOString());
    return { ok: true, value: next, saved: await save(await db(), next, person, profile.organization_id, profile.id) };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Yes: does the recommended action and sends the message on its channel,
 * through the app's existing send path. A channel the app can't send on is
 * marked reply by hand, and nothing is claimed as sent that wasn't.
 */
export async function decideYes(personKey: string, input: { message: string; byHand?: boolean }): Promise<BoardResult<CardState & { note: string | null }>> {
  try {
    const { profile, person, state } = await fresh(personKey);
    const sb = await db();
    const org = profile.organization_id;

    const check = canSend(person.messages, state.basedOn);
    if (!check.ok && !(check.reason === "nothing_to_answer" && state.action?.kind === "no_reply")) {
      const next: CardState =
        check.reason === "new_message"
          ? { ...state, lane: "breakdown", draft: null, cancelledAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
          : { ...state, lane: "track", draft: null, updatedAt: new Date().toISOString() };
      await save(sb, next, person, org, profile.id);
      return { ok: false, error: SEND_REFUSALS[check.reason] };
    }

    const action = state.action;
    const message = input.message.trim();
    let did: string | null = null;

    // The action first: a message saying it's booked must not go out if the booking didn't happen.
    if (action?.kind === "proposal_price") {
      const { data } = await sb.from("job_proposals").select("scope_snapshot").eq("job_id", action.jobId).maybeSingle();
      const zones = ((data?.scope_snapshot ?? []) as ProposalZoneSnapshot[]).map((z) => (z.zoneName === action.zoneName ? { ...z, priceCents: action.toCents, priceDerived: false } : z));
      if (!zones.some((z) => z.zoneName === action.zoneName)) return { ok: false, error: `${action.zoneName} isn't on the proposal any more.` };
      await updateProposalDraft(action.jobId, { totalCost: action.newTotalCents / 100, scopeSnapshot: zones });
      did = action.label;
    } else if (action?.kind === "proposal_remove") {
      const r = await trimSentProposal({ proposalId: action.proposalId, removeZones: [action.zoneName], removeLines: [], totalCents: action.newTotalCents, requestedVia: "text", notifyClient: false, note: "From the Communications Board" });
      if (!r.ok) return { ok: false, error: r.message };
      did = action.label;
    } else if (action?.kind === "book") {
      const r = await acceptSuggestion({ jobId: action.jobId, date: action.date, crewProfileIds: action.crewProfileIds, because: action.because });
      if (!r.ok) return { ok: false, error: `Not booked: ${r.error}` };
      did = action.label;
    }

    if (action?.kind === "no_reply") {
      const next = applySent(state, { body: "", channel: "other", at: new Date().toISOString(), byHand: false, did: action.label });
      return { ok: true, value: { ...next, note: null }, saved: await save(sb, next, person, org, profile.id) };
    }
    if (!message) return { ok: false, error: "There's no message to send." };

    const where = replyChannel(person);
    const channel: ChannelId = isChannel(state.draftChannel) ? state.draftChannel : where.channel;
    let byHand = Boolean(input.byHand) || CHANNELS[channel].send === "hand" || (state.draftByHand ?? where.byHand);
    let note: string | null = null;

    if (!byHand) {
      const jobId = person.jobIds[0] ?? null;
      const lastIn = [...person.messages].reverse().find((m) => m.direction === "in" && m.channel === channel);
      if (channel === "sms" || channel === "email" || channel === "app") {
        if (!jobId) {
          byHand = true;
        } else {
          const r = await sendClientMessageVia(jobId, message, channel);
          if (!r.delivered && r.note) note = r.note;
        }
      } else if ((channel === "fb_dm" || channel === "ig_dm") && lastIn?.ref?.pageRowId) {
        const r = await sendMetaReply({ pageRowId: lastIn.ref.pageRowId, platform: lastIn.ref.platform ?? "", contactId: lastIn.ref.contactId ?? "", text: message });
        if (!r.ok) return { ok: false, error: r.error };
      } else if (channel === "google" && lastIn?.ref?.reviewId) {
        const r = await approveReviewReply(lastIn.ref.reviewId, message);
        if (!r.ok) return { ok: false, error: r.error };
      } else {
        byHand = true;
      }
    }
    if (byHand) note = `Reply by hand on ${CHANNELS[channel].label}: the app can't send there. Copy it and send it yourself.`;

    const next = applySent(state, { body: message, channel, at: new Date().toISOString(), byHand, did });
    return { ok: true, value: { ...next, note }, saved: await save(sb, next, person, org, profile.id) };
  } catch (err) {
    return fail(err);
  }
}

// ---------------------------------------------------------------------------
// Add a message: channels with no feed
// ---------------------------------------------------------------------------

export async function addMessage(input: {
  customerId: string | null;
  name: string;
  phone: string;
  email: string;
  channel: string;
  body: string;
  at: string | null;
}): Promise<BoardResult<{ id: string }>> {
  try {
    const profile = await viewer();
    const body = input.body.trim();
    if (!body) return { ok: false, error: "Write what they said." };
    if (!isChannel(input.channel)) return { ok: false, error: "Pick where it came from." };
    if (!input.customerId && !input.name.trim() && !input.phone.trim() && !input.email.trim()) return { ok: false, error: "Pick a person, or give a name, phone or email." };
    const sb = await db();
    const { data, error } = await sb
      .from("comms_manual_messages")
      .insert({
        organization_id: profile.organization_id,
        customer_id: input.customerId,
        contact_name: input.name.trim() || null,
        contact_phone: input.phone.trim() || null,
        contact_email: input.email.trim().toLowerCase() || null,
        channel: input.channel,
        body: body.slice(0, 5000),
        received_at: input.at && !Number.isNaN(Date.parse(input.at)) ? new Date(input.at).toISOString() : new Date().toISOString(),
        created_by: profile.id,
      })
      .select("id")
      .maybeSingle();
    if (error) return { ok: false, error: isMissingTable(error) ? MIGRATION_NOTE : error.message };
    revalidatePath("/conversations/board");
    return { ok: true, value: { id: String((data as { id: string } | null)?.id ?? "") }, saved: true };
  } catch (err) {
    return fail(err);
  }
}
