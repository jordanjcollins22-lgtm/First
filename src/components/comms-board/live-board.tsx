"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";

import { CommsBoard, type BoardApi } from "@/components/comms-board/comms-board";
import {
  addMessage,
  answerQuestion,
  breakdownCard,
  decideNo,
  decideYes,
  draftCard,
  findContacts,
  loadPersonRecord,
  parkCard,
  startCard,
} from "@/lib/actions/comms-board-actions";
import type { BoardCard } from "@/lib/comms-board";

/** The board on the real messages, through the server actions. */
export function LiveBoard({ cards, today, needsMigration }: { cards: BoardCard[]; today: string; needsMigration: boolean }) {
  const router = useRouter();
  const api = useMemo<BoardApi>(
    () => ({
      loadRecord: async (card) => {
        const r = await loadPersonRecord({ customerId: card.person.customerId, jobIds: card.person.jobIds });
        return r.ok ? r.value : null;
      },
      start: startCard,
      breakdown: breakdownCard,
      draft: draftCard,
      answer: answerQuestion,
      no: decideNo,
      yes: (key, message, byHand) => decideYes(key, { message, byHand }),
      park: parkCard,
      addMessage: async (input) => {
        const r = await addMessage(input);
        if (r.ok) router.refresh();
        return r;
      },
      findContacts: async (q) => {
        const r = await findContacts(q);
        return r.ok ? r.value : [];
      },
    }),
    [router]
  );
  return <CommsBoard initialCards={cards} api={api} today={today} needsMigration={needsMigration} />;
}
