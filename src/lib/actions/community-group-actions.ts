"use server";

import { revalidatePath } from "next/cache";

import Anthropic from "@anthropic-ai/sdk";

import { createClient } from "@/lib/supabase/server";
import { env, isAnthropicConfigured } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/team";
import { readTriage, triageBrief, triageSystemPrompt } from "@/lib/group-triage";
import {
  GROUP_PLATFORMS,
  POST_KINDS,
  triageLocally,
  URGENCIES,
  type PostKind,
  type Urgency,
} from "@/lib/community-groups";

/**
 * Running the groups from in here.
 *
 * Everything in this file writes to our own tables. None of it reaches
 * Facebook, and none of it can: the Groups API was discontinued on 22 April
 * 2024, so no app may read a group's feed, publish to it, or decline a pending
 * post, and no app may message a member who has not messaged the page first.
 *
 * The blocking is done by Facebook's own Admin Assist, set up once per group
 * from the words kept here. The sorting, the pricing, the passes and the leads
 * are ours, and this is where they are written.
 */

const GROUPS_PATH = "/admin/groups";

export type GroupResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { value?: undefined } : { value: T }))
  | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/**
 * Create a group, or change one.
 *
 * The price is the interesting field. Null means business posts are not for
 * sale here and the answer to a business is simply no; a number means there is
 * something to send them to, which is the difference between a rule and an
 * income.
 */
export async function saveGroup(input: {
  id: string | null;
  name: string;
  area: string;
  platform: string;
  externalUrl: string;
  memberCount: string;
  businessPostDollars: string;
  passDays: string;
  declineMessage: string;
  blockWords: string;
}): Promise<GroupResult<{ id: string }>> {
  const profile = await getCurrentProfile();
  if (!profile) return fail("Not signed in.");

  const name = input.name.trim();
  if (!name) return fail("Give the group a name.");
  if (!GROUP_PLATFORMS.some((p) => p.key === input.platform)) return fail("Pick where the group is.");

  const memberCount = numberOrNull(input.memberCount);
  if (memberCount !== null && memberCount < 0) return fail("Members can't be negative.");

  const dollars = numberOrNull(input.businessPostDollars);
  if (dollars !== null && dollars <= 0) return fail("A business post has to cost something, or nothing at all.");
  const businessPostCents = dollars === null ? null : Math.round(dollars * 100);

  const passDays = numberOrNull(input.passDays) ?? 30;
  if (passDays < 1 || passDays > 365) return fail("A pass lasts between 1 and 365 days.");

  // One per line is how somebody types a list, and how Facebook's own box
  // wants them back. Commas are allowed too, because half of people use them.
  const blockWords = input.blockWords
    .split(/[\n,]/)
    .map((word) => word.trim())
    .filter(Boolean)
    .slice(0, 200);

  const row = {
    organization_id: profile.organization_id,
    name,
    area: input.area.trim() || null,
    platform: input.platform,
    external_url: input.externalUrl.trim() || null,
    member_count: memberCount,
    business_post_cents: businessPostCents,
    pass_days: Math.round(passDays),
    decline_message: input.declineMessage.trim() || null,
    block_words: blockWords,
    updated_at: new Date().toISOString(),
  };

  const supabase = await createClient();
  if (input.id) {
    const { error } = await supabase.from("community_groups").update(row).eq("id", input.id);
    if (error) return fail(error.message);
    revalidatePath(GROUPS_PATH);
    return { ok: true, value: { id: input.id } };
  }

  const { data, error } = await supabase.from("community_groups").insert(row).select("id").single();
  if (error || !data) return fail(error?.message ?? "Couldn't save that group.");
  revalidatePath(GROUPS_PATH);
  return { ok: true, value: { id: data.id } };
}

/**
 * Put a group away, or bring it back.
 *
 * Archived rather than deleted. The posts and the passes belong to it, and a
 * group that stopped being worth running is still the answer to "what did we
 * try last spring".
 */
export async function archiveGroup(input: { id: string; archived: boolean }): Promise<GroupResult> {
  const profile = await getCurrentProfile();
  if (!profile) return fail("Not signed in.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("community_groups")
    .update({ archived_at: input.archived ? new Date().toISOString() : null })
    .eq("id", input.id);
  if (error) return fail(error.message);

  revalidatePath(GROUPS_PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Sorting a post
// ---------------------------------------------------------------------------

export interface TriageReading {
  kind: PostKind;
  service: string | null;
  urgency: Urgency | null;
  author: string | null;
  summary: string;
  matchedWords: string[];
  /** Whether a model read it, or only the keyword pass did. */
  readByModel: boolean;
}

/**
 * Read a post and say what it is.
 *
 * Always answers. The keyword pass runs first and costs nothing, and it is
 * what comes back when there is no key, no network, or a reply that will not
 * parse. The model is asked on top of it because keywords cannot tell "my yard
 * is a jungle after that storm, what do you all do?" from small talk, and that
 * post is a customer.
 *
 * Nothing is written here. A person looks at the answer and files it, because
 * the one thing worse than an unsorted lead is a confident wrong one.
 */
export async function triagePost(input: {
  groupId: string;
  pastedText: string;
  screenshotPath: string | null;
  note: string;
}): Promise<GroupResult<TriageReading>> {
  const profile = await getCurrentProfile();
  if (!profile) return fail("Not signed in.");

  const supabase = await createClient();
  const [{ data: group }, { data: serviceRows }] = await Promise.all([
    supabase
      .from("community_groups")
      .select("id, name, block_words")
      .eq("id", input.groupId)
      .maybeSingle(),
    supabase
      .from("services")
      .select("name")
      .eq("organization_id", profile.organization_id)
      .eq("status", "active"),
  ]);

  if (!group) return fail("That group isn't one of ours.");

  const services = (serviceRows ?? []).map((row) => row.name).filter(Boolean);
  const blockWords = group.block_words ?? [];
  const local = triageLocally(input.pastedText, { blockWords, services });

  const fallback: TriageReading = {
    kind: local.kind,
    service: local.service,
    urgency: local.urgency,
    author: null,
    summary: "",
    matchedWords: local.matchedWords,
    readByModel: false,
  };

  const hasText = input.pastedText.trim().length > 0;
  if (!hasText && !input.screenshotPath) return fail("Paste the post, or add a screenshot of it.");
  if (!isAnthropicConfigured) return { ok: true, value: fallback };

  try {
    const content: Anthropic.ContentBlockParam[] = [];

    if (input.screenshotPath) {
      const { data: file } = await supabase.storage
        .from("recommendation-shots")
        .download(input.screenshotPath);
      if (file) {
        const type =
          file.type === "image/png" || file.type === "image/webp" ? file.type : "image/jpeg";
        content.push({
          type: "image",
          source: { type: "base64", media_type: type, data: Buffer.from(await file.arrayBuffer()).toString("base64") },
        });
      }
    }

    content.push({ type: "text", text: triageBrief({ pastedText: input.pastedText, note: input.note }) });

    const client = new Anthropic({ apiKey: env.anthropicApiKey });
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 800,
      thinking: { type: "adaptive" },
      // Sorting is a smaller job than writing the reply, and it runs on every
      // post rather than the ones somebody chose to answer.
      output_config: { effort: "low" },
      system: triageSystemPrompt({ groupName: group.name, services, blockWords }),
      messages: [{ role: "user", content }],
    });

    if (response.stop_reason === "refusal") return { ok: true, value: fallback };

    const raw = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    const read = readTriage(raw, services);
    if (!read) return { ok: true, value: fallback };

    return {
      ok: true,
      value: {
        kind: read.kind,
        service: read.service,
        urgency: read.urgency,
        author: read.author,
        summary: read.summary,
        // Both readings, because a phrase the keyword list caught is a phrase
        // the group's own rules name, and that is the one worth quoting back.
        matchedWords: Array.from(new Set([...local.matchedWords, ...read.matchedWords])),
        readByModel: true,
      },
    };
  } catch (err) {
    console.error("group triage failed:", err);
    return { ok: true, value: fallback };
  }
}

/** File a post, however it was sorted. */
export async function recordGroupPost(input: {
  groupId: string;
  kind: string;
  service: string;
  urgency: string;
  authorName: string;
  summary: string;
  matchedWords: string[];
  postedText: string;
  screenshotPath: string | null;
}): Promise<GroupResult<{ id: string }>> {
  const profile = await getCurrentProfile();
  if (!profile) return fail("Not signed in.");
  if (!POST_KINDS.some((k) => k.key === input.kind)) return fail("Say what kind of post it is.");

  const urgency = URGENCIES.some((u) => u.key === input.urgency) ? input.urgency : null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("community_group_posts")
    .insert({
      organization_id: profile.organization_id,
      group_id: input.groupId,
      kind: input.kind,
      service: input.kind === "request" ? input.service.trim() || null : null,
      urgency: input.kind === "request" ? urgency : null,
      author_name: input.authorName.trim().slice(0, 80) || null,
      summary: input.summary.trim().slice(0, 300) || null,
      matched_words: input.matchedWords.slice(0, 20),
      posted_text: input.postedText.trim().slice(0, 4000) || null,
      screenshot_path: input.screenshotPath,
    })
    .select("id")
    .single();

  if (error || !data) return fail(error?.message ?? "Couldn't file that post.");
  revalidatePath(GROUPS_PATH);
  return { ok: true, value: { id: data.id } };
}

/** Mark a request answered, so it stops appearing as work. */
export async function markPostHandled(input: {
  id: string;
  note: string;
  handled: boolean;
}): Promise<GroupResult> {
  const profile = await getCurrentProfile();
  if (!profile) return fail("Not signed in.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("community_group_posts")
    .update({
      handled_at: input.handled ? new Date().toISOString() : null,
      handled_note: input.handled ? input.note.trim().slice(0, 300) || null : null,
    })
    .eq("id", input.id);
  if (error) return fail(error.message);

  revalidatePath(GROUPS_PATH);
  return { ok: true };
}

/** Tick off a paid pass once the business has had their post. */
export async function markPassUsed(input: { id: string }): Promise<GroupResult> {
  const profile = await getCurrentProfile();
  if (!profile) return fail("Not signed in.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("group_post_passes")
    .update({ status: "used" })
    .eq("id", input.id)
    .eq("status", "paid");
  if (error) return fail(error.message);

  revalidatePath(GROUPS_PATH);
  return { ok: true };
}

function numberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}
