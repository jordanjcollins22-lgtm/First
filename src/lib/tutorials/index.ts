import type { V2Role } from "@/lib/data/v2";
import type { Tour } from "@/lib/tutorials/types";
import { ownerTour } from "@/lib/tutorials/tours/owner";
import { accountManagerTour } from "@/lib/tutorials/tours/account-manager";
import { evaluatorTour } from "@/lib/tutorials/tours/evaluator";
import { projectLeadTour } from "@/lib/tutorials/tours/project-lead";
import { projectTechnicianTour } from "@/lib/tutorials/tours/project-technician";
import { affiliateTour } from "@/lib/tutorials/tours/affiliate";

export const TOURS: Record<V2Role, Tour> = {
  owner: ownerTour,
  "account-manager": accountManagerTour,
  evaluator: evaluatorTour,
  "project-lead": projectLeadTour,
  "project-technician": projectTechnicianTour,
  affiliate: affiliateTour,
};

/** The tours for somebody's roles, in the order they appear, empty ones left out. */
export function toursFor(roles: readonly V2Role[]): Tour[] {
  return roles.map((r) => TOURS[r]).filter((t) => t.steps.length > 0);
}
