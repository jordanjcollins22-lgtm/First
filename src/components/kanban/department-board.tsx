import {
  getBacklogGroups,
  getBoardText,
  getWipLimits,
  listBoardCards,
  syncMarketingBacklog,
  syncOperationsBacklog,
  syncSalesBacklog,
} from "@/lib/data/kanban";
import type { Department } from "@/lib/kanban/board";

import { KanbanBoard } from "./kanban-board";

/** What fills each Backlog, said above the board. */
const BACKLOG_NOTE: Record<Department, string> = {
  marketing: "Every new lead from the last 30 days is in Backlog, with whether they booked. Add marketing ideas under Internal. ",
  sales: "Every lead that needs reaching out to is in Backlog, and comes off once they are contacted. New leads join at the bottom. ",
  operations: "Every job that still needs doing is in Backlog. New jobs join at the bottom. ",
  admin: "Backlog is anything the admin has to do. ",
};

/** The Board subtab of a department: its cards and its WIP limits. */
export async function DepartmentBoard({ department }: { department: Department }) {
  // A failed sync still shows the board as it stands.
  if (department === "operations") {
    await syncOperationsBacklog().catch((err) => console.error("Operations backlog sync failed:", err));
  }
  if (department === "marketing") {
    await syncMarketingBacklog().catch((err) => console.error("Marketing backlog sync failed:", err));
  }
  if (department === "sales") {
    await syncSalesBacklog().catch((err) => console.error("Sales backlog sync failed:", err));
  }
  const [cards, limits, groups, text] = await Promise.all([
    listBoardCards(department),
    getWipLimits(department),
    getBacklogGroups(department),
    getBoardText(department),
  ]);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        {BACKLOG_NOTE[department]}
        Pull the top card from Backlog. Groom the backlog daily. Drag cards, or use the arrows on each card.
      </p>
      <KanbanBoard department={department} cards={cards} limits={limits} groups={groups} text={text} />
    </div>
  );
}
