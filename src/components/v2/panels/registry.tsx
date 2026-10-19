import type { JSX } from "react";

import { ApprovalAutoPanel, ApprovalNumbersPanel, ApprovalQueuePanel } from "@/components/v2/panels/approval-queue";
import { CrewAutoPanel, CrewBonusPanel, CrewBudgetPanel, CrewNeedsPanel } from "@/components/v2/panels/crew-budget";
import { EmailApprovalHeldPanel, EmailApprovalPolicyPanel } from "@/components/v2/panels/email-approval-policy";
import { EquipmentAutoPanel, EquipmentMachinesPanel, EquipmentNeedsPanel, EquipmentPanel } from "@/components/v2/panels/equipment-panel";
import {
  FinanceAutoPanel,
  FinanceNeedsPanel,
  FinanceOwedPanel,
  FinancePayrollPanel,
  FinanceRevenuePanel,
  FinanceScorecardPanel,
} from "@/components/v2/panels/finance";
import { IntegrationsNeedsPanel, IntegrationsPanel } from "@/components/v2/panels/integrations";
import { FixitPanel } from "@/components/v2/panels/fixit-panel";
import { JobCostingNeedsPanel, JobCostingPanel } from "@/components/v2/panels/job-costing";
import { ProjectsAutoPanel, ProjectsNeedsPanel, ProjectsNumbersPanel } from "@/components/v2/panels/projects-autopilot";
import { PurchasingAutoPanel, PurchasingNeedsPanel, PurchasingOrdersPanel, PurchasingStockPanel } from "@/components/v2/panels/purchasing-panel";
import { TaskListPanel } from "@/components/v2/panels/task-list";
import { WeatherAutoPanel, WeatherNeedsPanel, WeatherPanel } from "@/components/v2/panels/weather-panel";
import { SnowAutoPanel, SnowBillingPanel, SnowNeedsPanel, SnowStormPanel } from "@/components/v2/panels/snow-ops-panel";
import { ComplianceAutoPanel, ComplianceNeedsPanel, CompliancePanel } from "@/components/v2/panels/compliance-panel";
import { CommissionsAutoPanel, CommissionsNeedsPanel, CommissionsPanel } from "@/components/v2/panels/commissions-panel";
import { PeopleAutoPanel, PeopleNeedsPanel, PeopleOnboardingPanel, PeopleRolesPanel } from "@/components/v2/panels/people-panel";
import { PipelineAutoPanel, PipelineNeedsPanel, PipelineNumbersPanel, PipelineRatesPanel } from "@/components/v2/panels/pipeline-autopilot";
import { PhotoQuotesPanel } from "@/components/v2/panels/photo-quotes";
import { EvaluatorNeedsPanel, EvaluatorScorecardPanel } from "@/components/v2/panels/evaluator-scorecard";
import { TerritoriesNeedsPanel, TerritoriesPanel, TerritoryRoutingPanel } from "@/components/v2/panels/territories";
import {
  MessagesAutoPanel,
  MessagesCampaignsPanel,
  MessagesNeedsPanel,
  MessagesNumbersPanel,
} from "@/components/v2/panels/client-messages-settings";
import {
  MarketingAutoPanel,
  MarketingEmailPanel,
  MarketingGooglePanel,
  MarketingLeadsPanel,
  MarketingNeedsPanel,
  MarketingSpendPanel,
} from "@/components/v2/panels/marketing-autopilot";
import { ReviewsPanel, ReviewsWaitingPanel } from "@/components/v2/panels/reviews";
import { PhysicalAutoPanel, PhysicalNeedsPanel, PhysicalPlaysPanel, PhysicalResultsPanel } from "@/components/v2/panels/physical-marketing";
import { AffiliateHomePanel } from "@/components/v2/panels/role/affiliate-home";
import { AccountManagerSalesPanel } from "@/components/v2/panels/role/am-sales";
import { AccountManagerAccountsPanel } from "@/components/v2/panels/role/am-accounts";
import { EvaluatorHomePanel } from "@/components/v2/panels/role/evaluator-home";
import { LeadHomePanel } from "@/components/v2/panels/role/lead-home";
import { CrewHomePanel } from "@/components/v2/panels/role/crew-home";

/**
 * The working screens the new layout's choices can show, by key. Each is an
 * async server component that loads its own data (a family of screens shares
 * one cached load per request). V2_GROUPS in lib/data/v2.ts names which keys
 * each choice shows, and which of them share a button.
 *
 * One job per screen: "-needs" is only what needs the owner, "-auto" only the
 * switches and settings, and the rest one set of numbers or records each.
 */
export const PANELS: Record<string, () => Promise<JSX.Element>> = {
  // Marketing › Digital marketing
  "marketing-needs": MarketingNeedsPanel,
  "reviews-waiting": ReviewsWaitingPanel,
  "marketing-leads": MarketingLeadsPanel,
  "marketing-spend": MarketingSpendPanel,
  "marketing-google": MarketingGooglePanel,
  reviews: ReviewsPanel,
  "marketing-email": MarketingEmailPanel,
  "marketing-auto": MarketingAutoPanel,
  // Marketing › Physical marketing
  "physical-needs": PhysicalNeedsPanel,
  "physical-plays": PhysicalPlaysPanel,
  "physical-results": PhysicalResultsPanel,
  "physical-auto": PhysicalAutoPanel,
  // Sales › Pipeline
  "pipeline-needs": PipelineNeedsPanel,
  "photo-quotes": PhotoQuotesPanel,
  "pipeline-numbers": PipelineNumbersPanel,
  "pipeline-rates": PipelineRatesPanel,
  "pipeline-auto": PipelineAutoPanel,
  // Sales › Evaluations
  "evaluator-needs": EvaluatorNeedsPanel,
  "territories-needs": TerritoriesNeedsPanel,
  "evaluator-scorecard": EvaluatorScorecardPanel,
  "territory-routing": TerritoryRoutingPanel,
  territories: TerritoriesPanel,
  // Sales › Automated messages
  "messages-needs": MessagesNeedsPanel,
  "email-approval-held": EmailApprovalHeldPanel,
  "messages-numbers": MessagesNumbersPanel,
  "messages-auto": MessagesAutoPanel,
  "messages-campaigns": MessagesCampaignsPanel,
  "email-approval-policy": EmailApprovalPolicyPanel,
  // Operations › Projects
  "projects-needs": ProjectsNeedsPanel,
  "weather-needs": WeatherNeedsPanel,
  "snow-needs": SnowNeedsPanel,
  "projects-numbers": ProjectsNumbersPanel,
  weather: WeatherPanel,
  "snow-storms": SnowStormPanel,
  "snow-billing": SnowBillingPanel,
  "projects-auto": ProjectsAutoPanel,
  "weather-auto": WeatherAutoPanel,
  "snow-auto": SnowAutoPanel,
  // Operations › Materials & equipment
  "purchasing-needs": PurchasingNeedsPanel,
  "equipment-needs": EquipmentNeedsPanel,
  "purchasing-orders": PurchasingOrdersPanel,
  "purchasing-stock": PurchasingStockPanel,
  equipment: EquipmentPanel,
  "equipment-machines": EquipmentMachinesPanel,
  "purchasing-auto": PurchasingAutoPanel,
  "equipment-auto": EquipmentAutoPanel,
  // Operations › Team
  "crew-needs": CrewNeedsPanel,
  "crew-budget": CrewBudgetPanel,
  "crew-bonus": CrewBonusPanel,
  "crew-auto": CrewAutoPanel,
  // Admin › Oversight
  "approval-queue": ApprovalQueuePanel,
  "approval-numbers": ApprovalNumbersPanel,
  "approval-auto": ApprovalAutoPanel,
  // Admin › Finance
  "finance-needs": FinanceNeedsPanel,
  "job-costing-needs": JobCostingNeedsPanel,
  "commissions-needs": CommissionsNeedsPanel,
  "finance-revenue": FinanceRevenuePanel,
  "finance-scorecard": FinanceScorecardPanel,
  "finance-owed": FinanceOwedPanel,
  "job-costing": JobCostingPanel,
  commissions: CommissionsPanel,
  "finance-payroll": FinancePayrollPanel,
  "finance-auto": FinanceAutoPanel,
  "commissions-auto": CommissionsAutoPanel,
  // Admin › Team & access
  "people-needs": PeopleNeedsPanel,
  "people-onboarding": PeopleOnboardingPanel,
  "people-roles": PeopleRolesPanel,
  "people-auto": PeopleAutoPanel,
  // Admin › Settings
  "integrations-needs": IntegrationsNeedsPanel,
  "compliance-needs": ComplianceNeedsPanel,
  integrations: IntegrationsPanel,
  compliance: CompliancePanel,
  "compliance-auto": ComplianceAutoPanel,
  fixit: FixitPanel,
  // Admin › Task list
  "task-list": TaskListPanel,
  // Each role's own home screen
  "affiliate-home": AffiliateHomePanel,
  "am-sales": AccountManagerSalesPanel,
  "am-accounts": AccountManagerAccountsPanel,
  "evaluator-home": EvaluatorHomePanel,
  "lead-home": LeadHomePanel,
  "crew-home": CrewHomePanel,
};
