/**
 * One made-up evaluation, used by every practice page, so the site map, the
 * proposal and the crew sheet are visibly the same job at three stages.
 *
 * Three zones as the evaluator drew and recorded them: the service, where
 * it is, its size, the checklist answers and notes, the crew time and the
 * materials. The proposal practice prices them; the crew sheet practice
 * turns them into the sheet. Nothing here is a real client or a real price.
 */

import { zonePhases, type WorkOrder } from "@/lib/work-order";
import { crewInstructions } from "@/lib/crew-instructions";

export const PRACTICE_ADDRESS = "12 Example Court, Bel Air, Maryland 21014";

export interface PracticeZone {
  id: string;
  name: string;
  service: string;
  location: string;
  sizeLabel: string;
  color: string;
  /** The shape on the sample map, in a 400 by 260 box. */
  points: { x: number; y: number }[];
  /** The evaluator's checklist answers: the crew's instructions. */
  tasks: { label: string; value: string }[];
  notes: string;
  /** The rate-card service and the evaluator's answers, as the site map saves them. */
  typeId: string;
  values: Record<string, string>;
  /** The evaluator's note to the crew. */
  crewNote: string;
  /** Photos taken at the evaluation: pictures that ship with the site. */
  photos: string[];
  crewHours: number;
  materials: { material: string; quantityLabel: string; cost: number }[];
}

export const PRACTICE_ZONES: PracticeZone[] = [
  {
    id: "front-beds",
    name: "Front beds",
    service: "Landscape Bed",
    location: "Either side of the front steps",
    sizeLabel: "24 × 6 ft",
    color: "#2f6d3c",
    points: [
      { x: 120, y: 190 },
      { x: 280, y: 190 },
      { x: 280, y: 225 },
      { x: 120, y: 225 },
    ],
    tasks: [
      { label: "Old material", value: "Pull the old mulch and weeds" },
      { label: "Edge", value: "Natural cut edge" },
      { label: "Mulch", value: "Black, 3 inches deep" },
      { label: "Plants", value: "Three low shrubs by the steps" },
    ],
    notes: "Pull the old mulch and weeds, edge the beds, and lay fresh black mulch. Plant three low shrubs by the steps.",
    typeId: "landscape-bed",
    values: {
      bedWork: "Renewal",
      material: "Mulch",
      existingMaterial: "Mulch",
      existingMaterialCondition: "Needs Removal",
      weedLevel: "Moderate",
      edge: "Existing Edge Needs Redone",
      newPlantInstallation: "Select Plants",
      newPlantInstallation__qty: "3",
    },
    crewNote: "Black mulch. The three new shrubs go by the steps: one each side and one at the corner.",
    photos: ["/booking-work/front-bed-mulch-trim.jpg"],
    crewHours: 6,
    materials: [
      { material: "Black mulch", quantityLabel: "3 cubic yards", cost: 126 },
      { material: "Shrubs", quantityLabel: "3 plants", cost: 90 },
    ],
  },
  {
    id: "foundation",
    name: "Around the house",
    service: "Landscape Bed",
    location: "Along the foundation, left side",
    sizeLabel: "40 × 3 ft",
    color: "#3b7dd8",
    points: [
      { x: 80, y: 60 },
      { x: 100, y: 60 },
      { x: 100, y: 180 },
      { x: 80, y: 180 },
    ],
    tasks: [
      { label: "Old material", value: "Weed by hand" },
      { label: "Edge", value: "Natural cut edge" },
      { label: "Mulch", value: "Black, to match the front" },
    ],
    notes: "Weed and edge the bed along the foundation and top it with black mulch to match the front.",
    typeId: "landscape-bed",
    values: {
      bedWork: "Existing Bed Maintenance",
      material: "Mulch",
      existingMaterial: "Mulch",
      existingMaterialCondition: "Normal",
      weedLevel: "Light",
      edge: "Existing Good Edge",
    },
    crewNote: "Black mulch to match the front. Keep the mulch clear of the dryer vent at the back corner.",
    photos: ["/booking-work/bed-edging-mulch.jpg"],
    crewHours: 4,
    materials: [{ material: "Black mulch", quantityLabel: "2 cubic yards", cost: 84 }],
  },
  {
    id: "side-yard",
    name: "Side yard",
    service: "Plant / Bush Removal",
    location: "Right side, by the fence",
    sizeLabel: "2 shrubs",
    color: "#d8763b",
    points: [
      { x: 310, y: 70 },
      { x: 360, y: 70 },
      { x: 360, y: 140 },
      { x: 310, y: 140 },
    ],
    tasks: [
      { label: "Remove", value: "Two shrubs taller than the fence" },
      { label: "Roots", value: "Dig out" },
      { label: "Haul away", value: "Yes" },
    ],
    notes: "Take out two overgrown shrubs taller than the fence, dig out the roots and haul them away.",
    typeId: "plant-bush-removal",
    values: { type: "Bush", quantity: "2", size: "Large", afterward: "Return to Lawn" },
    crewNote: "Both are taller than the fence. The gate is on the left: keep it latched, there's a dog.",
    photos: ["/booking-work/overgrowth-removal-mulch.jpg"],
    crewHours: 3,
    materials: [],
  },
];

/**
 * What each sample area is priced at on the sample proposal, in cents: its
 * crew-hours at a rough rate plus its materials, marked up. The same number
 * on the account manager's preview and the client's sample proposal.
 */
export function practicePriceCents(zone: PracticeZone): number {
  return Math.round((zone.crewHours * 60 + zone.materials.reduce((sum, m) => sum + m.cost, 0)) * 2.2) * 100;
}

/** The sample zones as the crew sheet reads them. */
export function practiceWorkOrder(): WorkOrder {
  return {
    zones: PRACTICE_ZONES.map((z) => ({
      id: z.id,
      name: z.name,
      color: z.color,
      points: z.points,
      service: z.service,
      location: z.location,
      sizeLabel: z.sizeLabel,
      tasks: z.tasks,
      todo: crewInstructions(z.typeId, z.values),
      phases: zonePhases(z.typeId, z.values),
      notes: z.crewNote,
      photos: z.photos.map((path) => ({ path, markers: [] })),
    })),
  };
}
