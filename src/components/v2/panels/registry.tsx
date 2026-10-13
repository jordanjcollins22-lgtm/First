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
import { WeatherPanel } from "@/components/v2/panels/weather-panel";
import { SnowOpsPanel } from "@/components/v2/panels/snow-ops-panel";
import { CompliancePanel } from "@/components/v2/panels/compliance-panel";
import { CommissionsPanel } from "@/components/v2/panels/commissions-panel";
import { PeoplePanel } from "@/components/v2/panels/people-panel";
import { PipelineAutopilotPanel } from "@/components/v2/panels/pipeline-autopilot";
import { EvaluatorScorecardPanel } from "@/components/v2/panels/evaluator-scorecard";
import { TerritoriesPanel } from "@/components/v2/panels/territories";
import { ClientMessagesSettingsPanel } from "@/components/v2/panels/client-messages-settings";
import { MarketingAutopilotPanel } from "@/components/v2/panels/marketing-autopilot";
import { ReviewsPanel } from "@/components/v2/panels/reviews";
import { PhysicalMarketingPanel } from "@/components/v2/panels/physical-marketing";
import { AffiliateHomePanel } from "@/components/v2/panels/role/affiliate-home";
import { AccountManagerSalesPanel } from "@/components/v2/panels/role/am-sales";
import { AccountManagerAccountsPanel } from "@/components/v2/panels/role/am-accounts";
import { EvaluatorHomePanel } from "@/components/v2/panels/role/evaluator-home";
import { LeadHomePanel } from "@/components/v2/panels/role/lead-home";
import { CrewHomePanel } from "@/components/v2/panels/role/crew-home";

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
  weather: WeatherPanel,
  "snow-ops": SnowOpsPanel,
  compliance: CompliancePanel,
  commissions: CommissionsPanel,
  people: PeoplePanel,
  "pipeline-autopilot": PipelineAutopilotPanel,
  "evaluator-scorecard": EvaluatorScorecardPanel,
  territories: TerritoriesPanel,
  "client-messages": ClientMessagesSettingsPanel,
  "marketing-autopilot": MarketingAutopilotPanel,
  reviews: ReviewsPanel,
  "physical-marketing": PhysicalMarketingPanel,
  "affiliate-home": AffiliateHomePanel,
  "am-sales": AccountManagerSalesPanel,
  "am-accounts": AccountManagerAccountsPanel,
  "evaluator-home": EvaluatorHomePanel,
  "lead-home": LeadHomePanel,
  "crew-home": CrewHomePanel,
};
