"use client";

import { useEffect, useState } from "react";

import { CommsBoard, type ApiResult, type BoardApi } from "@/components/comms-board/comms-board";
import { SAMPLE_HINTS, SAMPLE_MESSAGES, SAMPLE_RAW, SAMPLE_TODAY, sampleStates } from "@/components/comms-board/sample";
import {
  applyNo,
  applySent,
  buildBoard,
  canSend,
  CHANNELS,
  groupByPerson,
  isChannel,
  noWhy,
  replyChannel,
  replyCheck,
  SEND_REFUSALS,
  type BoardCard,
  type BoardMessage,
  type CardState,
  type Person,
} from "@/lib/comms-board";
import { keywordIntent, resolveIntent } from "@/lib/comms-intents";
import { EMPTY_RAW, factsFrom } from "@/lib/comms-person";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The sample's in-memory store and the board actions that change it. */
function makeSample() {
  const s = { messages: [...SAMPLE_MESSAGES], states: new Map(sampleStates().map((x) => [x.personKey, x])), n: 0 };
  let onCards: (cards: BoardCard[]) => void = () => {};
  const api: BoardApi = (() => {
    const people = () => groupByPerson(s.messages);
    const person = (key: string): Person | undefined => people().find((p) => p.key === key);
    const stateOf = (key: string): CardState => s.states.get(key) ?? { personKey: key, lane: "backlog", noReasons: [] };
    const keep = (st: CardState): ApiResult<CardState> => {
      s.states.set(st.personKey, st);
      return { ok: true, value: st, saved: true };
    };
    const now = () => new Date().toISOString();
    const rawOf = (key: string) => SAMPLE_RAW[key] ?? EMPTY_RAW;
    const said = (p: Person) => replyCheck(p.messages).unread.map((m) => m.text);

    return {
      loadRecord: async (card) => {
        await wait(250);
        return rawOf(card.personKey);
      },
      start: async (key) => keep({ ...stateOf(key), lane: "breakdown", updatedAt: now() }),
      breakdown: async (key) => {
        await wait(900);
        const p = person(key);
        if (!p) return { ok: false, error: "Not on the board." };
        const st = stateOf(key);
        const check = replyCheck(p.messages);
        if (check.alreadyReplied) return keep({ ...st, lane: "track", basedOn: check.lastIn?.at ?? null, updatedAt: now() });
        const lastIn = check.lastIn;
        const hint = SAMPLE_HINTS[key] ?? { intent: keywordIntent(said(p), lastIn?.channel), summary: "" };
        const b = resolveIntent({ facts: factsFrom(rawOf(key), p.name, SAMPLE_TODAY), hint, said: said(p), answer: st.answer, today: SAMPLE_TODAY });
        return keep({ ...st, lane: b.question ? "track" : "doing", intent: b.intent, intentSummary: b.summary, resources: b.resources, action: b.action, question: b.question, draft: null, basedOn: lastIn?.at ?? null, cancelledAt: null, updatedAt: now() });
      },
      draft: async (key) => {
        await wait(700);
        const p = person(key);
        const st = stateOf(key);
        if (!p || !st.intent) return { ok: false, error: "Break it down first." };
        const b = resolveIntent({ facts: factsFrom(rawOf(key), p.name, SAMPLE_TODAY), hint: SAMPLE_HINTS[key] ?? { intent: st.intent, summary: st.intentSummary ?? "" }, said: said(p), answer: st.answer, today: SAMPLE_TODAY });
        const where = replyChannel(p);
        const redo = st.noReasons?.length ? ` (Redone because: ${st.noReasons.at(-1)?.why})` : "";
        return keep({ ...st, lane: "doing", draft: b.message, draftChannel: where.channel, draftByHand: where.byHand, intentSummary: `${st.intentSummary ?? ""}${redo}`, updatedAt: now() });
      },
      answer: async (key, text) => keep({ ...stateOf(key), lane: "breakdown", answer: text, question: null, updatedAt: now() }),
      no: async (key, picked, typed) => {
        const why = noWhy(picked, typed);
        if ("error" in why) return { ok: false, error: why.error };
        return keep(applyNo(stateOf(key), why.why, now()));
      },
      yes: async (key, message, byHand) => {
        await wait(400);
        const p = person(key);
        const st = stateOf(key);
        if (!p) return { ok: false, error: "Not on the board." };
        const check = canSend(p.messages, st.basedOn);
        if (!check.ok && !(check.reason === "nothing_to_answer" && st.action?.kind === "no_reply")) return { ok: false, error: SEND_REFUSALS[check.reason] };
        const did = st.action && st.action.kind !== "send" ? st.action.label : null;
        if (st.action?.kind === "no_reply") {
          const next = applySent(st, { body: "", channel: "other", at: now(), byHand: false, did });
          s.states.set(key, next);
          return { ok: true, value: { ...next, note: null }, saved: true };
        }
        const channel = isChannel(st.draftChannel) ? st.draftChannel : replyChannel(p).channel;
        const hand = Boolean(byHand) || Boolean(st.draftByHand) || CHANNELS[channel].send === "hand";
        const at = now();
        s.messages.push({ id: `sent-${++s.n}`, channel, direction: "out", text: message, at, customerId: p.customerId, phone: p.phones[0] ?? null, email: p.emails[0] ?? null, handle: p.handles[0] ?? null });
        const next = applySent(st, { body: message, channel, at, byHand: hand, did });
        s.states.set(key, next);
        return { ok: true, value: { ...next, note: `Sample: nothing was sent.${hand ? ` Reply by hand on ${CHANNELS[channel].label}.` : ""}` }, saved: true };
      },
      park: async (key, followUpOn) => keep({ ...stateOf(key), lane: "track", followUpOn, updatedAt: now() }),
      addMessage: async (input) => {
        if (!input.body.trim()) return { ok: false, error: "Write what they said." };
        if (!isChannel(input.channel)) return { ok: false, error: "Pick where it came from." };
        const match = people().find((p) => (input.customerId && p.customerId === input.customerId) || (input.name && p.name.toLowerCase() === input.name.trim().toLowerCase()));
        const msg: BoardMessage = {
          id: `added-${++s.n}`,
          channel: input.channel,
          direction: "in",
          text: input.body.trim(),
          at: new Date().toISOString(),
          name: match?.name ?? (input.name.trim() || null),
          customerId: match?.customerId ?? null,
          phone: match ? match.phones[0] ?? null : input.phone.trim() || null,
          email: match ? match.emails[0] ?? null : input.email.trim() || null,
          handle: match?.handles[0] ?? null,
          jobId: match?.jobIds[0] ?? null,
        };
        if (!match && !msg.name && !msg.phone && !msg.email) return { ok: false, error: "Pick a person, or give a name, phone or email." };
        s.messages.push(msg);
        onCards(buildBoard(groupByPerson(s.messages), [...s.states.values()]));
        return { ok: true, value: { id: msg.id }, saved: true };
      },
      findContacts: async (q) =>
        people()
          .filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()))
          .slice(0, 8)
          .map((p) => ({ id: p.customerId ?? p.key, name: p.name, phone: p.phones[0] ?? null, email: p.emails[0] ?? null })),
    };
  })();
  return {
    api,
    initial: buildBoard(groupByPerson(s.messages), [...s.states.values()]),
    listen: (f: (cards: BoardCard[]) => void) => {
      onCards = f;
    },
  };
}

/**
 * The board on made-up people, for /review/comms-board. Runs the same lane,
 * breakdown and Yes/No rules as the live board, in memory. Saves nothing and
 * sends nothing.
 */
export function SampleBoard() {
  const [kit] = useState(makeSample);
  const [cards, setCards] = useState(kit.initial);
  useEffect(() => kit.listen(setCards), [kit]);
  return <CommsBoard initialCards={cards} api={kit.api} today={SAMPLE_TODAY} sample />;
}
