/**
 * What each working screen is called on its button. Plain data, safe in the browser.
 *
 * The same few names on every choice: "Needs you" first, then one button per
 * set of numbers named for what it shows, then "Automatic" for the switches.
 * A screen that shares another's button (V2_GROUPS' together) is named here
 * all the same, for its own heading's sake and in case it ever stands alone.
 */
export const PANEL_LABEL: Record<string, string> = {
  // Marketing › Digital marketing
  "marketing-needs": "Needs you",
  "reviews-waiting": "Replies waiting",
  "marketing-leads": "Leads & cost",
  "marketing-spend": "Spend",
  "marketing-google": "Google numbers",
  reviews: "Reviews",
  "marketing-email": "Email",
  "marketing-auto": "Automatic",
  // Marketing › Physical marketing
  "physical-needs": "Needs you",
  "physical-plays": "Plays",
  "physical-results": "What paid off",
  "physical-auto": "Automatic",
  // Sales › Pipeline
  "pipeline-needs": "Needs you",
  "photo-quotes": "Photo quotes",
  "pipeline-numbers": "Sales numbers",
  "pipeline-rates": "Rates",
  "pipeline-auto": "Automatic",
  // Sales › Evaluations
  "evaluator-needs": "Needs you",
  "territories-needs": "Territories to fix",
  "evaluator-scorecard": "Scorecard",
  "territory-routing": "Routing",
  territories: "Territories",
  // Sales › Automated messages
  "messages-needs": "Needs you",
  "email-approval-held": "Held emails",
  "messages-numbers": "Message numbers",
  "messages-auto": "Automatic",
  "messages-campaigns": "Campaigns",
  "email-approval-policy": "Email approvals",
  // Operations › Projects
  "projects-needs": "Needs you",
  "weather-needs": "Weather to decide",
  "snow-needs": "Snow to decide",
  "projects-numbers": "Project numbers",
  weather: "Weather",
  "snow-storms": "Snow storms",
  "snow-billing": "Snow billing",
  "projects-auto": "Automatic",
  "weather-auto": "Weather settings",
  "snow-auto": "Snow settings",
  // Operations › Materials & equipment
  "purchasing-needs": "Needs you",
  "equipment-needs": "Equipment to fix",
  "purchasing-orders": "Orders",
  "purchasing-stock": "Upcoming & stock",
  equipment: "Service due",
  "equipment-machines": "Machines",
  "purchasing-auto": "Automatic",
  "equipment-auto": "Equipment settings",
  // Operations › Team
  "crew-needs": "Needs you",
  "crew-budget": "Today's hours",
  "crew-bonus": "Crew bonus",
  "crew-auto": "Automatic",
  // Admin › Oversight
  "approval-queue": "Needs you",
  "approval-numbers": "Queue numbers",
  "approval-auto": "Automatic",
  // Admin › Finance
  "finance-needs": "Needs you",
  "job-costing-needs": "Jobs over hours",
  "commissions-needs": "Commissions to approve",
  "finance-revenue": "Revenue & cash",
  "finance-scorecard": "Weekly scorecard",
  "finance-owed": "Owed to you",
  "job-costing": "Job costing",
  commissions: "Commissions",
  "finance-payroll": "Payroll",
  "finance-auto": "Automatic",
  "commissions-auto": "Commission settings",
  // Admin › Team & access
  "people-needs": "Needs you",
  "people-onboarding": "Onboarding",
  "people-roles": "Roles",
  "people-auto": "Automatic",
  // Admin › Settings
  "integrations-needs": "Needs you",
  "compliance-needs": "Compliance due",
  integrations: "Integrations",
  compliance: "Compliance calendar",
  "compliance-auto": "Automatic",
  fixit: "Fix-it tickets",
  // Admin › Task list
  "task-list": "To-do list",
  // Each role's own home screen
  "affiliate-home": "My links & earnings",
  "am-sales": "My sales",
  "am-accounts": "My accounts",
  "evaluator-home": "My visits",
  "lead-home": "My day",
  "crew-home": "My day",
};
