"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { pauseAgent, saveAgentSettings } from "@/lib/data/outreach-agent";
import { normaliseGroupUrl, type AgentGroup } from "@/lib/outreach-agent";

/**
 * The owner's hand on the group agent: which groups, how many a day, when,
 * and the stop button.
 */

type Result = { ok: true } | { ok: false; error: string };

export async function updateAgentSettings(input: {
  groups: AgentGroup[];
  keywords: string;
  dailyCap: number;
  hourlyCap: number;
  activeFrom: string;
  activeTo: string;
  scanEveryMinutes: number;
  maxAgeDays: number;
  autoPost: boolean;
}): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!isOwnerLevel(profile.roles)) return { ok: false, error: "Only the owner can change this." };

  const groups: AgentGroup[] = [];
  for (const group of input.groups) {
    const url = normaliseGroupUrl(group.url);
    if (!url) return { ok: false, error: `"${group.url}" is not a Facebook group link.` };
    if (groups.some((g) => g.url === url)) continue;
    groups.push({ url, name: group.name.trim().slice(0, 120) || url.split("/groups/")[1]?.replace(/\/$/, "") || "Group" });
  }
  const keywords = input.keywords
    .split(/[\n,]/)
    .map((word) => word.trim().toLowerCase())
    .filter((word, index, all) => word.length > 1 && all.indexOf(word) === index)
    .slice(0, 80);
  if (keywords.length === 0) return { ok: false, error: "Keep at least one keyword, or every post gets read." };

  const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!clock.test(input.activeFrom) || !clock.test(input.activeTo)) return { ok: false, error: "Hours need to look like 08:00." };

  const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, Math.round(Number(value) || 0)));

  try {
    await saveAgentSettings(profile.organization_id, profile.id, {
      groups,
      keywords,
      dailyCap: clamp(input.dailyCap, 0, 40),
      hourlyCap: clamp(input.hourlyCap, 0, 10),
      activeFrom: input.activeFrom,
      activeTo: input.activeTo,
      scanEveryMinutes: clamp(input.scanEveryMinutes, 10, 240),
      maxAgeDays: clamp(input.maxAgeDays, 0, 30),
      autoPost: Boolean(input.autoPost),
    });
  } catch (err) {
    console.error("agent settings failed to save:", err);
    return { ok: false, error: "Couldn't save that. Try again." };
  }
  revalidatePath("/admin/outreach/agent");
  return { ok: true };
}

/** Stop for a day, or until told otherwise. */
export async function pauseGroupAgent(input: { hours: number | null; reason: string }): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!isOwnerLevel(profile.roles)) return { ok: false, error: "Only the owner can change this." };
  const until = input.hours ? new Date(Date.now() + input.hours * 3_600_000) : new Date("2099-01-01T00:00:00Z");
  try {
    await pauseAgent(profile.organization_id, profile.id, until, input.reason.trim().slice(0, 200) || "Paused by hand.");
  } catch (err) {
    console.error("agent pause failed:", err);
    return { ok: false, error: "Couldn't pause it. Try again." };
  }
  revalidatePath("/admin/outreach/agent");
  return { ok: true };
}

export async function resumeGroupAgent(): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!isOwnerLevel(profile.roles)) return { ok: false, error: "Only the owner can change this." };
  try {
    await pauseAgent(profile.organization_id, profile.id, null, null);
  } catch (err) {
    console.error("agent resume failed:", err);
    return { ok: false, error: "Couldn't resume it. Try again." };
  }
  revalidatePath("/admin/outreach/agent");
  return { ok: true };
}
