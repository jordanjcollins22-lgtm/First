"use server";

import { getCurrentProfile } from "@/lib/data/team";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { cleanAnswers } from "@/lib/evaluation-intake";
import { instantPrice, type InstantPrice } from "@/lib/instant-price";

/**
 * The instant price for a demo form's answers. Signed in only: this is not
 * offered to clients yet, and the rate card is the business's own.
 */
export async function demoInstantPrice(
  answers: unknown,
  lot: { lotSqft: number | null; structureSqft: number | null } | null
): Promise<{ price: InstantPrice } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Sign in to the app to see the demo's instant price." };
  const catalog = await getCanvasCatalog();
  return { price: instantPrice(cleanAnswers(answers), lot, catalog) };
}
