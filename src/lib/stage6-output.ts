/**
 * Stage 6 of the job pipeline: output generation. For now, the customer
 * scope of work line for one work item, from the operation's scope template.
 *
 * Only the confirmed work, in the words of the template: never extra work
 * (root removal, disposal) unless the approved scope includes it, and no
 * time, crew or price.
 */

import type { WorkItem } from "@/lib/evaluation-line-items";
import { findOperation, type Library } from "@/lib/resource-library";

const UNIT_WORDS: Record<WorkItem["unit"], string> = {
  sqft: "square feet",
  lnft: "linear feet",
  sqyd: "square yards",
  cuyd: "cubic yards",
  each: "",
  ton: "tons",
  lb: "pounds",
  gal: "gallons",
  hr: "hours",
};

export function scopeLine(lib: Library, item: WorkItem): string | null {
  const found = findOperation(lib, item);
  if (!found?.op.scope_template) return null;
  const name = (found.subtype?.name ?? found.material.name).toLowerCase();
  return found.op.scope_template
    .replaceAll("{qty}", String(item.quantity))
    .replaceAll("{unit}", UNIT_WORDS[item.unit])
    .replaceAll("{subtype}", name)
    .replace(/\s+/g, " ")
    .trim();
}
