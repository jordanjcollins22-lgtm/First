import type { JSX } from "react";

import { ApprovalQueuePanel } from "@/components/v2/panels/approval-queue";
import { CrewBudgetPanel } from "@/components/v2/panels/crew-budget";
import { EmailApprovalPolicyPanel } from "@/components/v2/panels/email-approval-policy";
import { EquipmentPanel } from "@/components/v2/panels/equipment-panel";
import { FinancePanel } from "@/components/v2/panels/finance";
import { IntegrationsPanel } from "@/components/v2/panels/integrations";
import { JobCostingPanel } from "@/components/v2/panels/job-costing";
import { ProjectsAutopilotPanel } from "@/components/v2/panels/projects-autopilot";
import { PurchasingPanel } from "@/components/v2/panels/purchasing-panel";
import { TaskListPanel } from "@/components/v2/panels/task-list";

/**
 * The working screens the new layout's choices can show, by key. Each is an
 * async server component that loads its own data. V2_GROUPS in
 * lib/data/v2.ts names which keys each choice shows.
 */
export const PANELS: Record<string, () => Promise<JSX.Element>> = {
  "approval-queue": ApprovalQueuePanel,
  "crew-budget": CrewBudgetPanel,
  "email-approval-policy": EmailApprovalPolicyPanel,
  equipment: EquipmentPanel,
  finance: FinancePanel,
  integrations: IntegrationsPanel,
  "job-costing": JobCostingPanel,
  "projects-autopilot": ProjectsAutopilotPanel,
  purchasing: PurchasingPanel,
  "task-list": TaskListPanel,
};
