/**
 * Reading an area's photos for the pricing report: Claude suggests the
 * conditions (weed density, access, slope, soil, overgrowth) and the tasks
 * it can see with their counts, and the office confirms or changes them
 * before anything is priced. A suggestion is only ever kept beside the area;
 * the report prices the area's own conditions and tasks.
 *
 * Pure: the schema, the instructions and the clean-up of what comes back.
 */

import { z } from "zod";

import type { AreaSuggestion } from "@/lib/pricing-report";
import { CONDITIONS, type AreaConditions, type ProductionRate } from "@/lib/pricing-variables";

const conditionEnum = (key: string) => {
  const def = CONDITIONS.find((c) => c.key === key)!;
  const values: [string, ...string[]] = ["unsure", ...def.options.map((o) => o.value)];
  return z.enum(values).describe(`${def.label}: ${def.options.map((o) => `${o.value} = ${o.label}`).join("; ")}; unsure when the photos don't show it.`);
};

export const PhotoSuggestionSchema = z.object({
  weeds: conditionEnum("weeds"),
  access: conditionEnum("access"),
  slope: conditionEnum("slope"),
  soil: conditionEnum("soil"),
  overgrowth: conditionEnum("overgrowth"),
  tasks: z
    .array(
      z.object({
        key: z.string().describe("A task key, exactly as listed."),
        count: z.number().nullable().describe("For EA tasks: how many you can count (plants, shrubs, stumps). Null for SF, LF, CY and TON tasks."),
        why: z.string().describe("Under 12 words: what in the photo shows it."),
      })
    )
    .describe("Tasks the photos show are needed, from the list. Leave out anything you can't see."),
  notes: z.string().describe("One or two short sentences the office should know: anything the photos can't settle."),
});
export type PhotoSuggestion = z.infer<typeof PhotoSuggestionSchema>;

export function suggestionSystemPrompt(rates: Pick<ProductionRate, "key" | "task" | "unit">[]): string {
  return [
    "You help a landscaping company in Harford County, Maryland price work from photos of one area of a property.",
    "Say what conditions the photos show and which tasks from the list below the work needs. For tasks counted each (EA), count what you can see: plants, shrubs and stumps by size. Small is under 2 ft, medium 2 to 4 ft, large over 4 ft.",
    "The office confirms everything before it is priced, so say unsure rather than guess, and leave out tasks you cannot see a reason for.",
    "Never give prices, hours or measurements in square or linear feet: the office measures.",
    "",
    "Tasks (key | task | unit):",
    ...rates.map((r) => `${r.key} | ${r.task} | ${r.unit}`),
  ].join("\n");
}

export function suggestionBrief(area: { name: string; wants?: string | null; taskLabels?: string[] }): string {
  return [
    `Area: ${area.name}`,
    area.wants?.trim() ? `What the client wants done here: ${area.wants.trim()}` : "",
    area.taskLabels?.length ? `Tasks already on it: ${area.taskLabels.join("; ")}` : "",
    "The photos of this area are above.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * What came back, made safe for the office to look at: only conditions and
 * options that exist, only tasks on the list, counts only on counted tasks,
 * whole and in a sane range, each task once.
 */
export function cleanSuggestion(raw: PhotoSuggestion, rates: Pick<ProductionRate, "key" | "unit">[], at: string): AreaSuggestion {
  const conditions: AreaConditions = {};
  for (const def of CONDITIONS) {
    const v = (raw as Record<string, unknown>)[def.key];
    if (typeof v === "string" && def.options.some((o) => o.value === v)) conditions[def.key] = v;
  }
  const unitOf = new Map(rates.map((r) => [r.key, r.unit]));
  const seen = new Set<string>();
  const tasks: AreaSuggestion["tasks"] = [];
  for (const t of raw.tasks ?? []) {
    const unit = unitOf.get(t.key);
    if (!unit || seen.has(t.key)) continue;
    seen.add(t.key);
    const count = unit === "EA" && typeof t.count === "number" && Number.isFinite(t.count) && t.count > 0 && t.count <= 500 ? Math.round(t.count) : null;
    tasks.push({ key: t.key, qty: count, why: String(t.why ?? "").slice(0, 120) });
    if (tasks.length >= 15) break;
  }
  return { conditions, tasks, notes: String(raw.notes ?? "").slice(0, 400), at };
}
