import type { ProjectInput } from "@/lib/pricing-report";

/**
 * A realistic bed refresh, for the review page: three areas at a house in
 * Bel Air, priced from the code's starting variables, so the report can be
 * checked without a project in the database. Nothing here is a real client.
 */
export const SAMPLE_PROJECT: ProjectInput = {
  name: "Front and side bed refresh",
  client: "Sample client",
  address: "Bel Air, MD 21014",
  crew: { leads: 1, techs: 1 },
  driveMinutesEachWay: 25,
  disposalTrips: 1,
  direct: { delivery: 0, subcontractors: 0, rentals: 0, permits: 0, other: 0 },
  areas: [
    {
      id: "front",
      name: "Front beds",
      sf: 420,
      lf: 95,
      depthIn: 3,
      confirmed: true,
      conditions: { weeds: "moderate", access: "easy", slope: "flat", soil: "hard", overgrowth: "overgrown" },
      tasks: [
        { key: "bed-preparation.moderate-weed-removal" },
        { key: "bed-preparation.bed-edging" },
        { key: "plant-maintenance.medium-shrub-trimming", qty: 6 },
        { key: "plant-maintenance.perennial-cutback", qty: 12 },
        { key: "bed-installation.mulch-installation" },
      ],
    },
    {
      id: "side",
      name: "Side yard strip",
      sf: 180,
      lf: 60,
      depthIn: 2,
      confirmed: true,
      conditions: { weeds: "heavy", access: "tight", slope: "flat", soil: "rocky", overgrowth: "maintained" },
      tasks: [
        { key: "bed-preparation.heavy-weed-removal" },
        { key: "bed-installation.landscape-fabric-installation" },
        { key: "bed-installation.landscape-staples" },
        { key: "bed-installation.decorative-rock-installation" },
      ],
    },
    {
      id: "back",
      name: "Back corner bed",
      sf: 150,
      lf: 40,
      depthIn: 3,
      confirmed: true,
      conditions: { weeds: "light", access: "tight", slope: "moderate", soil: "hard", overgrowth: "maintained" },
      tasks: [
        { key: "bed-preparation.medium-shrub-removal", qty: 2 },
        { key: "bed-installation.three-gallon-shrub-installation", qty: 3 },
        { key: "bed-installation.small-perennial-installation", qty: 8 },
        { key: "bed-installation.mulch-installation" },
        { key: "cleanup-and-debris.debris-loading", qty: 1.5 },
        { key: "cleanup-and-debris.final-property-cleanup", qty: 750 },
      ],
    },
  ],
};
