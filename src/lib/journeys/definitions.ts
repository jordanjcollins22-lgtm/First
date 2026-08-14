import type { JourneyStepType } from "@/types/domain";

/**
 * The single source of truth for code-managed journeys — this is what "the
 * dashboard follows the app" means in practice. When the real flow changes
 * (a step is added, removed, or rewired), change it here; the dashboard
 * picks it up on next load via syncCodeManagedJourneys(). Admin-entered
 * numbers (clicks, time, comms, notes) on an existing step are preserved
 * across syncs — only structure (which steps exist, their order and
 * connections) is code-driven.
 *
 * Every step here reflects something that actually exists in the app today
 * — nothing aspirational. See src/app/evaluations, src/lib/actions/
 * job-actions.ts, and src/components/canvas/zone-service-dialog.tsx for the
 * real flow this mirrors.
 */

export interface JourneyStepTemplate {
  stepKey: string;
  order: number;
  label: string;
  stepType: JourneyStepType;
  roleLabel?: string;
  inputs?: string[];
  outputs?: string[];
  automations?: string[];
  nextSteps?: string[];
  clicks?: number;
  manualInputs?: number;
  customerComms?: number;
  internalComms?: number;
  texts?: number;
  emails?: number;
  calls?: number;
  estMinutes?: number | null;
  notes?: string | null;
}

export interface JourneyTemplate {
  roleKey: string;
  name: string;
  description: string;
  steps: JourneyStepTemplate[];
}

const evaluatorJourney: JourneyTemplate = {
  roleKey: "evaluator",
  name: "Evaluator Journey",
  description: "The real path today, from an assigned evaluation to submitting it.",
  steps: [
    {
      stepKey: "assigned",
      order: 0,
      label: "Open Assigned Evaluation",
      stepType: "human",
      roleLabel: "Evaluator",
      outputs: ["Customer, property, evaluation date visible", "Directions link"],
      nextSteps: ["on_my_way"],
      clicks: 1,
      estMinutes: 0.5,
      notes: "My Schedule page — lists every evaluation assigned to this person.",
    },
    {
      stepKey: "on_my_way",
      order: 1,
      label: "On My Way",
      stepType: "human",
      roleLabel: "Evaluator",
      outputs: ["evaluation_status = on_way"],
      automations: ["Status visible to Admin/AM"],
      nextSteps: ["arrived"],
      clicks: 1,
      estMinutes: 0.1,
    },
    {
      stepKey: "arrived",
      order: 2,
      label: "Arrived",
      stepType: "human",
      roleLabel: "Evaluator",
      outputs: ["evaluation_status = arrived"],
      nextSteps: ["start_evaluation"],
      clicks: 1,
      estMinutes: 0.1,
    },
    {
      stepKey: "start_evaluation",
      order: 3,
      label: "Start Evaluation",
      stepType: "human",
      roleLabel: "Evaluator",
      outputs: ["Opens the job's canvas page"],
      nextSteps: ["location"],
      clicks: 1,
      estMinutes: 0.1,
      notes: "A link, not a separate status — evaluation_status stays \"arrived\" until Submit.",
    },
    {
      stepKey: "location",
      order: 4,
      label: "Where Is This Zone Located?",
      stepType: "human",
      roleLabel: "Evaluator",
      inputs: ["Location description"],
      outputs: ["Zone location"],
      nextSteps: ["measurements"],
      clicks: 1,
      manualInputs: 1,
      estMinutes: 0.5,
      notes: "Its own page in the wizard.",
    },
    {
      stepKey: "measurements",
      order: 5,
      label: "What Are the Measurements?",
      stepType: "human",
      roleLabel: "Evaluator",
      inputs: ["Length (ft)", "Width (ft)"],
      outputs: ["Area/perimeter derived from length x width"],
      nextSteps: ["select_service"],
      clicks: 1,
      manualInputs: 2,
      estMinutes: 1,
      notes: "Its own page — area/perimeter are computed, never typed directly.",
    },
    {
      stepKey: "select_service",
      order: 6,
      label: "What Service Is This?",
      stepType: "human",
      roleLabel: "Evaluator",
      inputs: ["Service choice, or propose a new one"],
      outputs: ["Service attached to the zone"],
      automations: ["Auto-attach the service's tool checklist", "Auto-attach linked materials"],
      nextSteps: ["checklist"],
      clicks: 1,
      estMinutes: 0.3,
    },
    {
      stepKey: "checklist",
      order: 7,
      label: "What Would They Like Done?",
      stepType: "human",
      roleLabel: "Evaluator",
      inputs: ["Tap-select checklist items"],
      outputs: ["Checked items"],
      nextSteps: ["checklist_detail"],
      clicks: 2,
      estMinutes: 0.5,
      notes: "Its own page — only shown when the chosen service has checklist items; skipped straight to a Field Question or Materials otherwise.",
    },
    {
      stepKey: "checklist_detail",
      order: 8,
      label: "How Many? (Checklist Item Detail)",
      stepType: "human",
      roleLabel: "Evaluator",
      inputs: ["Quantity"],
      outputs: ["Quantity for that checked item"],
      nextSteps: ["checklist_detail", "service_field"],
      clicks: 1,
      manualInputs: 1,
      estMinutes: 0.3,
      notes: "One page per checklist item that was checked — a real loop, not one fixed page.",
    },
    {
      stepKey: "service_field",
      order: 9,
      label: "Service Field Question",
      stepType: "human",
      roleLabel: "Evaluator",
      inputs: ["Tap-select or typed answer"],
      outputs: ["Field value on the zone"],
      nextSteps: ["service_field", "materials"],
      clicks: 1,
      manualInputs: 1,
      estMinutes: 0.3,
      notes: "One page per other field the service defines (e.g. size, condition) — count varies by service.",
    },
    {
      stepKey: "materials",
      order: 10,
      label: "What Material Would They Like?",
      stepType: "human",
      roleLabel: "Evaluator",
      inputs: ["Tap-select type/color, only for materials with options defined"],
      outputs: ["Material choices"],
      automations: ["Materials with no defined options aren't asked about"],
      nextSteps: ["photos"],
      clicks: 2,
      estMinutes: 1,
      notes: "Its own page — skipped entirely if nothing on the service has type/color options.",
    },
    {
      stepKey: "photos",
      order: 11,
      label: "Any Photos?",
      stepType: "human",
      roleLabel: "Evaluator",
      inputs: ["Camera or library photos"],
      outputs: ["Photos attached to the zone"],
      nextSteps: ["notes"],
      clicks: 2,
      manualInputs: 1,
      estMinutes: 1,
    },
    {
      stepKey: "notes",
      order: 12,
      label: "Anything Else Worth Noting?",
      stepType: "human",
      roleLabel: "Evaluator",
      inputs: ["Typed note"],
      outputs: ["Notes attached to the zone"],
      nextSteps: ["review_zone"],
      clicks: 1,
      manualInputs: 1,
      estMinutes: 0.5,
    },
    {
      stepKey: "review_zone",
      order: 13,
      label: "Review Zone",
      stepType: "human",
      roleLabel: "Evaluator",
      outputs: ["Zone saved"],
      nextSteps: ["location", "submit_evaluation"],
      clicks: 1,
      estMinutes: 0.2,
      notes: "Its own page. Loops back to Location for another zone, or moves on to Submit.",
    },
    {
      stepKey: "submit_evaluation",
      order: 14,
      label: "Submit Evaluation",
      stepType: "human",
      roleLabel: "Evaluator",
      outputs: ["evaluation_status = completed"],
      nextSteps: [],
      clicks: 1,
      estMinutes: 0.1,
      notes: "One click. No missing-info check before submit yet — a real gap worth automating.",
    },
  ],
};

const clientJourney: JourneyTemplate = {
  roleKey: "client",
  name: "Client Journey",
  description: "Every real way a lead enters, converging into one system through to a job's current status.",
  steps: [
    {
      stepKey: "ghl_automation",
      order: 0,
      label: "GoHighLevel Automation",
      stepType: "system_action",
      roleLabel: "System",
      inputs: ["Webhook payload"],
      outputs: ["Customer + property + job created"],
      automations: ["Auto-create/match customer and property"],
      nextSteps: ["lead_created"],
      estMinutes: 0,
      notes: "The one fully automated intake channel today.",
    },
    {
      stepKey: "manual_entry",
      order: 0,
      label: "Manual Entry (New Property)",
      stepType: "human",
      roleLabel: "Admin/AM",
      inputs: ["Customer name, address"],
      outputs: ["Customer + property + job created"],
      nextSteps: ["lead_created"],
      clicks: 3,
      manualInputs: 2,
      estMinutes: 2,
      notes: "Admin/AM-facing only — the customer never sees this form. Covers a lead phoned or referred in with no public link to click.",
    },
    {
      stepKey: "public_schedule",
      order: 0,
      label: "Landing Page: Pick a Time",
      stepType: "customer_action",
      roleLabel: "Client",
      inputs: ["Date, then a time from the evaluator's real availability"],
      outputs: ["Time slot picked (not booked yet — held until the rest of the form is done)"],
      automations: [
        "Available times computed from weekly availability minus days off minus already-booked evaluations",
        "A specific evaluator's personal link narrows this to their calendar only; the org's general link or an account manager's link offers combined availability across every evaluator",
      ],
      nextSteps: ["public_landing_contact"],
      clicks: 2,
      estMinutes: 0.5,
      notes: "The public /book page — reached by clicking an ad (the org's own link) or a specific evaluator/account manager's personal affiliate link. Calendar first, then a day's open times on the right — picking a time moves straight into the rest of the form.",
    },
    {
      stepKey: "public_landing_contact",
      order: 0,
      label: "Landing Page: Your Info",
      stepType: "customer_action",
      roleLabel: "Client",
      inputs: ["First/last name", "Email", "Phone", "Property address"],
      outputs: ["Contact info + address captured"],
      nextSteps: ["public_confirm_house"],
      clicks: 2,
      manualInputs: 5,
      estMinutes: 1,
    },
    {
      stepKey: "public_confirm_house",
      order: 0,
      label: "Landing Page: Confirm Your Home",
      stepType: "customer_action",
      roleLabel: "Client",
      outputs: ["Address confirmed against a satellite pin"],
      nextSteps: ["public_landing_contact", "public_what_you_want"],
      clicks: 1,
      estMinutes: 0.2,
      notes: "\"No\" sends them back to fix the address; \"Yes\" continues.",
    },
    {
      stepKey: "public_what_you_want",
      order: 0,
      label: "Landing Page: What You Need",
      stepType: "customer_action",
      roleLabel: "Client",
      inputs: ["Service(s) wanted, from the real service catalog", "Optional notes"],
      outputs: ["Requested services + notes attached to the lead"],
      nextSteps: ["public_budget"],
      clicks: 2,
      manualInputs: 1,
      estMinutes: 0.5,
    },
    {
      stepKey: "public_budget",
      order: 0,
      label: "Landing Page: Budget Range",
      stepType: "customer_action",
      roleLabel: "Client",
      inputs: ["Budget bracket"],
      outputs: ["Customer + property + job created, evaluation booked at the time picked earlier"],
      automations: ["Budget range attached to the lead — helps match the right materials"],
      nextSteps: ["lead_created"],
      clicks: 1,
      estMinutes: 0.2,
      notes: "The submit step — this is where the held time slot is actually booked and the evaluator assigned, with no admin in the loop.",
    },
    {
      stepKey: "lead_created",
      order: 1,
      label: "Customer/Property/Job Created",
      stepType: "system_action",
      roleLabel: "System",
      outputs: ["Job in \"estimating\" status"],
      automations: ["Reuses an existing customer/property on an exact match instead of duplicating"],
      nextSteps: ["evaluation_scheduled"],
      estMinutes: 0,
    },
    {
      stepKey: "evaluation_scheduled",
      order: 2,
      label: "Evaluation Scheduled",
      stepType: "human",
      roleLabel: "Admin/AM",
      inputs: ["Date/time", "Evaluator assignment"],
      outputs: ["Evaluation on the evaluator's list"],
      nextSteps: ["evaluation_journey"],
      clicks: 2,
      manualInputs: 1,
      estMinutes: 1,
    },
    {
      stepKey: "evaluation_journey",
      order: 3,
      label: "Evaluation Happens",
      stepType: "human",
      roleLabel: "Evaluator",
      outputs: ["Zones, services, materials, photos, notes"],
      nextSteps: ["job_status"],
      estMinutes: null,
      notes: "The full Evaluator Journey — see that tab for the step-by-step.",
    },
    {
      stepKey: "job_status",
      order: 4,
      label: "Job Status Set",
      stepType: "human",
      roleLabel: "Admin/AM",
      inputs: ["Status: Estimating / Quoted / Approved / In Progress / Completed / Cancelled"],
      outputs: ["Job status updated"],
      nextSteps: ["repeat_property"],
      clicks: 1,
      estMinutes: 0.2,
      notes: "A manual internal field today — no proposal document, automated approval, or customer-facing send exists yet.",
    },
    {
      stepKey: "repeat_property",
      order: 5,
      label: "Repeat/Additional Property",
      stepType: "customer_action",
      roleLabel: "Customer",
      outputs: ["New property under the same customer"],
      automations: ["Reuses the existing customer record automatically"],
      nextSteps: ["lead_created"],
      estMinutes: null,
    },
  ],
};

export const JOURNEY_TEMPLATES: JourneyTemplate[] = [evaluatorJourney, clientJourney];

/** role_keys whose structure is code-driven — the UI disables add/remove/type edits for these, since a sync would just undo them. */
export const CODE_MANAGED_ROLE_KEYS = new Set(JOURNEY_TEMPLATES.map((t) => t.roleKey));
