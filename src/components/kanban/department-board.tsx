import { getWipLimits, listBoardCards } from "@/lib/data/kanban";
import type { Department } from "@/lib/kanban/board";

import { KanbanBoard } from "./kanban-board";

/** The Board subtab of a department: its cards and its WIP limits. */
export async function DepartmentBoard({ department }: { department: Department }) {
  const [cards, limits] = await Promise.all([listBoardCards(department), getWipLimits(department)]);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Pull the top card from Backlog. Groom the backlog daily. Drag cards, or use the arrows on each card.
      </p>
      <KanbanBoard department={department} cards={cards} limits={limits} />
    </div>
  );
}
