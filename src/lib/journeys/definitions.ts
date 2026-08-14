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
      notes: "My Evaluations page — lists every evaluation assigned to this person.",
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
      nextSteps: ["draw_area"],
      clicks: 1,
      estMinutes: 0.1,
      notes: "A link, not a separate status — evaluation_status stays \"arrived\" until Submit.",
    },
    {
      stepKey: "draw_area",
      order: 4,
      label: "Draw Area",
      stepType: "human",
      roleLabel: "Evaluator",
      inputs: ["Location", "Length x width"],
      outputs: ["Zone drawn on the map", "Area/perimeter derived"],
      nextSteps: ["select_service"],
      clicks: 3,
      manualInputs: 2,
      estMinutes: 2,
      notes: "Area/perimeter come from length x width — never typed directly.",
    },
    {
      stepKey: "select_service",
      order: 5,
      label: "Select Service",
      stepType: "human",
      roleLabel: "Evaluator",
      inputs: ["Service choice, or propose a new one"],
      outputs: ["Service attached to the zone"],
      automations: ["Auto-attach the service's tool checklist", "Auto-attach linked materials"],
      nextSteps: ["service_questions"],
      clicks: 1,
      estMinutes: 0.3,
    },
    {
      stepKey: "service_questions",
      order: 6,
      label: "Answer Service Questions",
      stepType: "human",
      roleLabel: "Evaluator",
      inputs: ["Tap-select checklist/field answers"],
      outputs: ["Zone field values"],
      nextSteps: ["materials"],
      clicks: 4,
      manualInputs: 1,
      estMinutes: 1.5,
      notes: "Only the original built-in services have these questions; a custom service skips straight through.",
    },
    {
      stepKey: "materials",
      order: 7,
      label: "Material Type & Color",
      stepType: "human",
      roleLabel: "Evaluator",
      inputs: ["Tap-select type/color, only for materials with options defined"],
      outputs: ["Material choices"],
      automations: ["Materials with no defined options aren't asked about"],
      nextSteps: ["photos"],
      clicks: 2,
      estMinutes: 1,
    },
    {
      stepKey: "photos",
      order: 8,
      label: "Photos",
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
      order: 9,
      label: "Notes",
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
      order: 10,
      label: "Review Zone / Another Area?",
      stepType: "human",
      roleLabel: "Evaluator",
      outputs: ["Zone saved"],
      nextSteps: ["draw_area", "submit_evaluation"],
      clicks: 1,
      estMinutes: 0.2,
      notes: "Loops back to Draw Area for another zone, or moves on to Submit.",
    },
    {
      stepKey: "submit_evaluation",
      order: 11,
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
      inputs: ["Name, contact info, address", "Marketing source, if any"],
      outputs: ["Customer + property + job created"],
      nextSteps: ["lead_created"],
      clicks: 3,
      manualInputs: 4,
      estMinutes: 2,
      notes: "Covers every other channel today (phone, referral, door-to-door, yard sign, direct mail...) — one form, with the marketing source picked from whatever attractor types/variants are defined.",
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
