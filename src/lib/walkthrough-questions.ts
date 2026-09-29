/**
 * The walkthrough's questions, and who answers each.
 *
 * Some are the client's to answer: what they want, what they like, what they
 * want kept. The evaluator reads those out, word for word, so they are
 * written the way a person would say them. When the client already answered
 * one on their pre-eval, it is not asked again: it is read back to confirm.
 *
 * The rest are the evaluator's own call from looking: how many weeds, what
 * shape the edge is in. The client is not asked those. How the work is done
 * is ours to decide and is never put to the client at all.
 *
 * Pure, so the wording and the sorting are tested without a screen.
 */

import type { ServiceFieldDef } from "@/components/canvas/service-catalog";

export type QuestionKind = "confirm" | "ask" | "check";

export interface Question {
  kind: QuestionKind;
  /** What goes on the screen: said out loud for confirm and ask. */
  text: string;
}

export const KIND_LABEL: Record<QuestionKind, string> = {
  confirm: "Confirm with the client",
  ask: "Ask the client",
  check: "You check · don't ask the client",
};

type ClientWording = { ask: string; confirm?: (value: string) => string };

const lower = (value: string) => value.toLowerCase();

/** The client's questions, by service and field. Anything not here is the evaluator's. */
const CLIENT: Record<string, ClientWording> = {
  "landscape-bed.material": {
    ask: "Would you like mulch or river rock in these beds?",
    confirm: (v) => `You picked ${v === "Rock" ? "river rock" : lower(v)} for these beds. Is that still right?`,
  },
  "landscape-bed.color": {
    ask: "What colour mulch would you like?",
    confirm: (v) => `You picked ${lower(v)} mulch. Is that still right?`,
  },
  "landscape-bed.rockSize": {
    ask: "What size river rock would you like?",
    confirm: (v) => `You picked ${lower(v)} river rock. Is that still right?`,
  },
  "plant-bush-removal.type": { ask: "What would you like taken out?" },
  "plant-bush-removal.afterward": { ask: "What would you like there once it's out?" },
  "plant-installation.plant": { ask: "What plants would you like?" },
  "plant-installation.quantity": { ask: "How many would you like?" },
  "plant-installation.locationWithinZone": { ask: "Where would you like them to go?" },
  "trimming.desiredResult": { ask: "Is there a way you'd like them trimmed?" },
  "landscape-cleanup.plantsStaying": { ask: "Are there any plants in here you want to keep?" },
  "lawn-restoration.method": {
    ask: "Would you like sod or seed?",
    confirm: (v) => `You picked ${lower(v)}. Is that still right?`,
  },
  "lawn-care.serviceType": {
    ask: "What would you like done to the lawn?",
    confirm: (v) => `You asked for ${lower(v)}. Is that still right?`,
  },
  "lawn-care.frequency": { ask: "How often would you like it done?" },
  "lawn-care.specialInstructions": { ask: "Is there anything we should know about the lawn?" },
  "leaf-seasonal-cleanup.type": { ask: "Would you like a leaf cleanup, a fall cutback, or a full fall cleanup?" },
  "leaf-seasonal-cleanup.grassesToCutBack": { ask: "Are there any grasses or perennials you'd like cut back?" },
  "soft-washing.surface": { ask: "What would you like washed?" },
  "soft-washing.stainingAreas": { ask: "Are there any stains or problem spots you'd like us to look at?" },
  "salting.surface": { ask: "What would you like salted?" },
  "salting.treatments": { ask: "How many treatments would you like? Three is the minimum." },
  "salting.petSafe": { ask: "Would you like the pet safe blend?" },
};

/** The evaluator's own questions, worded as what to look at. By field key, any service. */
const CHECK: Record<string, string> = {
  bedWork: "Is this a new bed, a refresh, or keeping one up?",
  existingMaterial: "What's in the beds now?",
  existingMaterialCondition: "How much old material is in the beds?",
  weedLevel: "How many weeds are there?",
  edge: "What shape is the bed edge in?",
  quantity: "How many are there?",
  size: "How big are they?",
  sizeContainer: "What size should the plants be?",
  installationType: "Is this a new planting or a replacement?",
  condition: "What shape is it in?",
  cleanupType: "What kind of cleanup is it?",
  overgrowth: "How overgrown is it?",
  vines: "How many vines are there?",
  saplings: "How many saplings are there?",
  naturalDebris: "How much debris is there?",
  soilCondition: "What's the soil like?",
  grade: "Does the grade need fixing?",
  lawnCondition: "What shape is the lawn in?",
  purpose: "What is the grading for?",
  severity: "How bad is it?",
  waterDirection: "Which way does the water need to go?",
  leafVolume: "How many leaves are there?",
  materialType: "What is the surface made of?",
  type: "What is it?",
};

function clientKey(typeId: string, key: string): string {
  return `${typeId}.${key}`;
}

/** Whether the client answers this field, or the evaluator does. */
export function isClientField(typeId: string, key: string): boolean {
  return clientKey(typeId, key) in CLIENT;
}

/**
 * The question for one field. A client's field they already answered on
 * their form is read back to confirm; one they didn't is asked. The
 * evaluator's fields are theirs to check, never read out.
 */
export function fieldQuestion(typeId: string, field: ServiceFieldDef, value: string | undefined, fromForm: boolean): Question {
  const client = CLIENT[clientKey(typeId, field.key)];
  if (!client) return { kind: "check", text: CHECK[field.key] ?? `${field.label}?` };
  if (fromForm && value && value !== "Other") {
    return { kind: "confirm", text: client.confirm ? client.confirm(value) : `You picked ${lower(value)}. Is that still right?` };
  }
  return { kind: "ask", text: client.ask };
}

/** The steps that are the same for every area. */
export const STEP_QUESTIONS = {
  measurements: { kind: "check", text: "Measure it." },
  checklist: { kind: "ask", text: "What would you like done in this area?" },
  materials: { kind: "ask", text: "Which would you like?" },
  photos: { kind: "check", text: "Take a photo of it." },
  notes: { kind: "check", text: "Anything the crew should know?" },
} as const satisfies Record<string, Question>;

/** A quantity for a checklist item: the evaluator counts. */
export function countQuestion(unit: string): Question {
  return { kind: "check", text: `How many ${unit}?` };
}
