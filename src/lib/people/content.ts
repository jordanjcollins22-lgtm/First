import type { PersonStage, TemplateLike } from "@/lib/people/lifecycle";

/**
 * The starter checklists and training modules. Loaded once into the editable
 * tables, so the business changes them on the Setup and Training pages, not
 * here. Legal items are marked apart from company preferences: ticking a box
 * records the step and never stands in for doing it correctly.
 */

type T = Omit<TemplateLike, "stage" | "sort" | "active" | "positions" | "applies_to" | "part" | "required" | "legal" | "due_days" | "due_business_days"> &
  Partial<Pick<TemplateLike, "positions" | "applies_to" | "part" | "required" | "legal" | "due_days" | "due_business_days">>;

const group = (stage: PersonStage, items: T[]): TemplateLike[] =>
  items.map((i, sort) => ({ stage, sort, active: true, positions: [], applies_to: "any", part: null, required: true, legal: false, due_days: null, due_business_days: null, ...i }));

const FIELD = ["project-technician", "project-lead"];

export const STARTER_TEMPLATES: TemplateLike[] = [
  ...group("application", [
    { item_key: "profile", label: "Application linked to one candidate profile", required: false },
    { item_key: "complete", label: "Required information complete", required: false },
  ]),
  ...group("screening", [
    { item_key: "criteria", label: "Checked against the position's minimum requirements", required: false },
    { item_key: "reason", label: "Decision and reason recorded", required: false },
  ]),
  ...group("interview", [
    { item_key: "scheduled", label: "Interview date confirmed", required: false },
    { item_key: "scorecard", label: "Same scorecard used and every area covered", required: false },
    { item_key: "decision", label: "Responses, results and decision documented", required: false },
  ]),
  ...group("job_offer", [
    { item_key: "terms", label: "Position, pay, schedule and responsibilities documented", required: false },
    { item_key: "transport", label: "Transportation and equipment requirements documented", required: false },
    { item_key: "classification", label: "Classification decided from the actual working relationship and applicable law", required: false, legal: true },
    { item_key: "agreements", label: "Applicable agreements attached", required: false },
  ]),
  ...group("onboarding", [
    { item_key: "i9", part: "compliance", label: "Form I-9 (within 3 business days of first day)", legal: true, applies_to: "employee", due_business_days: 3 },
    { item_key: "w4", part: "compliance", label: "Federal W-4", legal: true, applies_to: "employee", due_days: 0 },
    { item_key: "mw507", part: "compliance", label: "Maryland MW507", legal: true, applies_to: "employee", due_days: 0 },
    { item_key: "md_new_hire", part: "compliance", label: "Maryland new-hire report (within 20 days)", legal: true, applies_to: "employee", due_days: 20 },
    { item_key: "w9", part: "compliance", label: "W-9 on file", legal: true, applies_to: "contractor", due_days: 7 },
    { item_key: "agreements", part: "compliance", label: "Applicable agreements signed", due_days: 0 },
    { item_key: "emergency", part: "compliance", label: "Emergency contact on file", due_days: 0 },
    { item_key: "permissions", part: "compliance", label: "App account and system permissions set", due_days: 0 },
    { item_key: "license", part: "compliance", label: "Driver's license checked, if they will drive", required: false },
    { item_key: "pesticide", part: "compliance", label: "Pesticide employee training, if they will handle pesticides (confirm requirement)", required: false, legal: true, positions: FIELD, due_days: 30 },
    { item_key: "responsibilities", part: "clarity", label: "Position responsibilities explained" },
    { item_key: "expectations", part: "clarity", label: "Work expectations explained" },
    { item_key: "reporting", part: "clarity", label: "Reporting structure explained" },
    { item_key: "pay", part: "clarity", label: "Compensation and payment procedures explained" },
    { item_key: "communication", part: "clarity", label: "Communication expectations explained" },
    { item_key: "attendance", part: "clarity", label: "Attendance requirements explained" },
    { item_key: "quality", part: "clarity", label: "Quality standards explained" },
    { item_key: "safety", part: "clarity", label: "Safety requirements explained" },
    { item_key: "measures", part: "clarity", label: "Performance measurements explained" },
    { item_key: "values", part: "culture", label: "Values and operating standards explained: professionalism, customer service, respect for customer property, accountability, work quality, honesty, safety, communication, and continuous improvement" },
    { item_key: "people", part: "connection", label: "Introduced to the relevant people" },
    { item_key: "systems", part: "connection", label: "Introduced to the systems and communication channels" },
    { item_key: "who", part: "connection", label: "Clear who gives assignments, answers questions, evaluates work, and handles problems" },
    { item_key: "ack", part: "check_back", label: "Onboarding acknowledgment signed" },
    { item_key: "questions", part: "check_back", label: "Questions asked and answered" },
    { item_key: "initial_review", part: "check_back", label: "Initial review completed" },
  ]),
  ...group("training", [
    { item_key: "read_all", label: "All assigned written training read before going on the field" },
    { item_key: "library", label: "Training modules assigned for their position", required: false },
  ]),
  ...group("evaluation", [
    { item_key: "observed", label: "Evaluated on observed work against the written criteria", required: false },
    { item_key: "documented", label: "Results, notes or photos and final decision recorded", required: false },
  ]),
  ...group("deployment", [
    { item_key: "verified", label: "Verified competencies reviewed against the assignment" },
    { item_key: "first_assignment", label: "First assignment and responsible lead confirmed" },
  ]),
  ...group("performance_management", [
    { item_key: "review", label: "Performance review completed", required: false },
    { item_key: "measures", label: "Quality, reliability, safety, customer feedback and callbacks checked", required: false },
    { item_key: "follow_up", label: "Feedback and any retraining recorded", required: false },
  ]),
  ...group("offboarding", [
    { item_key: "final_admin", label: "Final administrative requirements complete", legal: true },
    { item_key: "final_pay", label: "Final pay handled", legal: true },
    { item_key: "property", label: "Company property returned" },
    { item_key: "access", label: "App and system access removed" },
    { item_key: "notes", label: "Reason and final notes recorded" },
  ]),
];

export interface StarterModule {
  module_key: string;
  title: string;
  purpose: string;
  materials: string[];
  safety: string[];
  steps: string[];
  standards: string[];
  mistakes: string[];
  practice: string;
  criteria: string[];
  competency_key: string;
  competency_label: string;
  positions: string[];
  required: boolean;
  /** Only the mulch example came complete in the document. The rest start as drafts for the owner to finish. */
  status: "draft" | "published";
  sort: number;
}

const PPE = ["Wear the required protective equipment.", "Review the work area for hazards before starting."];
const EVAL_BASE = "Can complete the assigned work safely, efficiently, and to company standards without corrective work.";

export const STARTER_MODULES: StarterModule[] = [
  {
    module_key: "mulch-installation",
    title: "Mulch Installation",
    purpose: "Teach a Project Technician to complete mulch installation according to company standards.",
    materials: ["Wheelbarrow", "Pitchfork", "Scoop shovel", "Buckets for reaching behind bushes", "Specified mulch"],
    safety: PPE,
    steps: [
      "Review project instructions.",
      "Verify the designated work area.",
      "Prepare beds as specified.",
      "Remove designated weeds and debris.",
      "Verify edges are properly prepared.",
      "Install the specified mulch at approximately 2 inches of depth unless otherwise instructed.",
      "Keep mulch away from trunks and plant crowns.",
      "Maintain consistent coverage.",
      "Clean surrounding surfaces.",
      "Take completion photographs.",
      "Submit the work for review.",
    ],
    standards: ["Approximately 2 inches deep unless otherwise instructed.", "Thin along the edge so there is a clear distinction and it does not wash out.", "Clear of trunks and plant crowns.", "Consistent coverage, with clean surrounding surfaces."],
    mistakes: ["Overfilling the edge.", "Piling mulch against trunks or plant crowns.", "Leaving debris on the lawn or hard surfaces."],
    practice: "Show them, then they show us on a real bed. Stop and correct anything wrong immediately. Once they can do it without us, they teach someone else.",
    criteria: ["Followed project instructions and work area", "Depth and coverage meet the standard", "Trunks, crowns and edges correct", "Surfaces clean and photos submitted", "Safe and efficient without corrective work"],
    competency_key: "mulch_installation",
    competency_label: "Mulch installation",
    positions: FIELD,
    required: true,
    status: "published",
    sort: 0,
  },
  {
    module_key: "bed-preparation",
    title: "Bed Preparation",
    purpose: "Teach a technician to get a bed ready for install, one zone and one stage at a time.",
    materials: ["Trimmers", "Shovels", "Reciprocating saw", "Tarp"],
    safety: PPE,
    steps: ["Take the before photos.", "Work top to bottom and back to front, within reason.", "Trim the bushes.", "Remove what is coming out with shovels and saws.", "Pull the weeds.", "Remove the old mulch or regrade the bed.", "Take the during photos and wait for them to pass before install."],
    standards: ["Finish the stage before moving on.", "No debris in the grass.", "Use a tarp before putting anything on the lawn."],
    mistakes: ["Moving to another zone before prep is finished.", "Starting install before the during photos pass."],
    practice: "Show them, then they show us on a real zone. Stop and correct anything wrong immediately. Once they can do it without us, they teach someone else.",
    criteria: ["Correct working order", "Everything coming out was removed", "Lawn protected", "During photos pass", EVAL_BASE],
    competency_key: "bed_preparation",
    competency_label: "Bed preparation",
    positions: FIELD,
    required: true,
    status: "draft",
    sort: 1,
  },
  {
    module_key: "dug-edging",
    title: "Dug Edging",
    purpose: "Teach a technician to cut a clean bed edge in four steps.",
    materials: ["String trimmer", "Edging shovel", "Steel toe boots"],
    safety: PPE,
    steps: ["Use a string trimmer to weed whack a line where the bed edge will be.", "Dig straight down with an edging shovel, then kick the shovel forward with a steel toe boot, back into the bed.", "Hold the shovel flat and dig a trench through the bottom of the edge.", "Regrade the slope on the inside of the bed so it's smooth and not aggressive."],
    standards: ["Clean, consistent edge.", "Smooth slope on the inside of the bed."],
    mistakes: ["Starting without the trimmer line.", "Leaving an aggressive slope."],
    practice: "Show them, then they show us on a real bed. Stop and correct anything wrong immediately. Once they can do it without us, they teach someone else.",
    criteria: ["Line follows the plan", "Edge and trench are clean", "Inside slope is smooth", EVAL_BASE],
    competency_key: "dug_edging",
    competency_label: "Dug edging",
    positions: FIELD,
    required: true,
    status: "draft",
    sort: 2,
  },
  {
    module_key: "plant-installation",
    title: "Plant Installation",
    purpose: "Teach a technician to plant to company standards.",
    materials: ["Shovel", "Specified plants"],
    safety: PPE,
    steps: ["Review the plan and placement.", "Dig the hole double the size of the pot, but the same depth.", "Set the plant in the hole.", "Backfill and tidy the area."],
    standards: ["Hole is double the pot size and the same depth."],
    mistakes: ["Digging the hole deeper than the pot."],
    practice: "Show them, then they show us on a real planting. Stop and correct anything wrong immediately. Once they can do it without us, they teach someone else.",
    criteria: ["Placement matches the plan", "Hole size and depth are correct", EVAL_BASE],
    competency_key: "plant_installation",
    competency_label: "Plant installation",
    positions: FIELD,
    required: true,
    status: "draft",
    sort: 3,
  },
  {
    module_key: "equipment-operation",
    title: "Equipment Operation",
    purpose: "Teach safe, correct use of the equipment assigned to the position.",
    materials: ["Assigned equipment", "Required protective equipment"],
    safety: [...PPE, "Do not run any equipment until trained on it."],
    steps: ["Inspect the equipment.", "Review its safe operation.", "Operate it under supervision.", "Clean and return it."],
    standards: ["Used safely and returned clean."],
    mistakes: ["Skipping the inspection."],
    practice: "Show them, then they show us on each piece of equipment. Stop and correct anything wrong immediately.",
    criteria: ["Inspection completed", "Operated safely", "Returned clean and in place"],
    competency_key: "equipment_operation",
    competency_label: "Equipment operation",
    positions: FIELD,
    required: true,
    status: "draft",
    sort: 4,
  },
  {
    module_key: "site-cleanup",
    title: "Site Cleanup",
    purpose: "Leave no debris behind, including in the grass.",
    materials: ["Blower", "Broom", "Rake", "Tarp"],
    safety: PPE,
    steps: ["Remove debris from beds and the lawn.", "Clean hard surfaces.", "Load tools and materials.", "Walk the property once more."],
    standards: ["No debris left behind, including in the grass."],
    mistakes: ["Skipping the final walk."],
    practice: "Show them, then they show us at the end of a real job. Stop and correct anything wrong immediately.",
    criteria: ["No debris remains", "Surfaces clean", "Tools loaded"],
    competency_key: "site_cleanup",
    competency_label: "Site cleanup",
    positions: FIELD,
    required: true,
    status: "draft",
    sort: 5,
  },
  {
    module_key: "project-documentation",
    title: "Project Documentation",
    purpose: "Teach the required app photos and submissions for each zone.",
    materials: ["Smartphone", "Company app"],
    safety: ["Do not use the phone while operating equipment or driving."],
    steps: ["Open the job and zone in the app.", "Take the before photos.", "Take the during photos after prep and wait for them to pass.", "Take the after photos.", "Fix anything sent back and resubmit."],
    standards: ["Clear photos for each required stage."],
    mistakes: ["Starting the next stage before the photos pass."],
    practice: "Show them, then they show us on a real zone.",
    criteria: ["Correct photos at each stage", "Submitted in order"],
    competency_key: "project_documentation",
    competency_label: "Project documentation",
    positions: FIELD,
    required: true,
    status: "draft",
    sort: 6,
  },
  {
    module_key: "customer-communication",
    title: "Customer Communication",
    purpose: "Teach respectful, professional communication with clients on site.",
    materials: ["Job notes"],
    safety: [],
    steps: ["Greet the client professionally.", "Know what the job includes.", "Report changes or problems to the lead.", "Follow the company's communication expectations."],
    standards: ["Professional and respectful.", "Changes are reported, not promised."],
    mistakes: ["Promising work or pricing that isn't on the job."],
    practice: "Practice with a trainer, then observe on a real job.",
    criteria: ["Professional and respectful", "Reported changes correctly"],
    competency_key: "customer_communication",
    competency_label: "Customer communication",
    positions: FIELD,
    required: true,
    status: "draft",
    sort: 7,
  },
  {
    module_key: "project-leadership",
    title: "Project Leadership",
    purpose: "Teach a Project Lead to run a crew and hand the client a finished job.",
    materials: ["Company app", "Job plan"],
    safety: ["Run a safety check before work starts."],
    steps: ["Plan the day from the job.", "Confirm tools and materials.", "Lead each zone in order.", "Coach and correct the crew.", "Walk the finished job.", "Communicate with the client."],
    standards: ["Job finished to standard without callbacks."],
    mistakes: ["Letting a zone move on before it passes."],
    practice: "Lead a job with a trainer present, then teach someone else.",
    criteria: ["Crew led safely and efficiently", "Quality met", "Client communication handled"],
    competency_key: "project_leadership",
    competency_label: "Project leadership",
    positions: ["project-lead"],
    required: true,
    status: "draft",
    sort: 8,
  },
];
