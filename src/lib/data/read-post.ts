import Anthropic from "@anthropic-ai/sdk";

import { createClient } from "@/lib/supabase/server";
import { env, isAnthropicConfigured } from "@/lib/env";
import { readPost, readingBrief, readingSystemPrompt, type PostReading } from "@/lib/post-reading";

/**
 * Looking at a screenshot and getting the post out of it.
 *
 * The one place the model is asked to read a post, shared by the two screens
 * that need it: sorting what was posted in a group we run, and answering
 * somebody's post in a group we do not. Two copies of this would drift, and
 * the one that drifted would be whichever nobody was watching.
 *
 * Returns null rather than throwing. Both callers have something honest to
 * show without it — a keyword reading, or the boxes as the person left them —
 * and a screen that dies because a vision call timed out is worse than a
 * screen that asks somebody to type the group name.
 */
export async function readPostFromScreenshot(input: {
  screenshotPath: string | null;
  pastedText: string;
  note: string;
  /** The group when it is already known. Empty when the picture has to say. */
  groupName: string;
  services: readonly string[];
  blockWords: readonly string[];
}): Promise<PostReading | null> {
  if (!isAnthropicConfigured) return null;
  if (!input.screenshotPath && !input.pastedText.trim()) return null;

  try {
    const content: Anthropic.ContentBlockParam[] = [];

    if (input.screenshotPath) {
      const supabase = await createClient();
      const { data: file } = await supabase.storage
        .from("recommendation-shots")
        .download(input.screenshotPath);
      if (file) {
        const type = file.type === "image/png" || file.type === "image/webp" ? file.type : "image/jpeg";
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: type,
            data: Buffer.from(await file.arrayBuffer()).toString("base64"),
          },
        });
      }
    }

    content.push({ type: "text", text: readingBrief({ pastedText: input.pastedText, note: input.note }) });

    const client = new Anthropic({ apiKey: env.anthropicApiKey });
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 900,
      thinking: { type: "adaptive" },
      // Reading a name off a screenshot is not the same job as writing the
      // reply, and this runs on every post rather than the chosen ones.
      output_config: { effort: "low" },
      system: readingSystemPrompt({
        groupName: input.groupName,
        services: input.services,
        blockWords: input.blockWords,
      }),
      messages: [{ role: "user", content }],
    });

    if (response.stop_reason === "refusal") return null;

    const raw = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    return readPost(raw, input.services);
  } catch (err) {
    console.error("couldn't read that post:", err);
    return null;
  }
}

/** The service names this business sells, for matching a post against. */
export async function activeServiceNames(organizationId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("services")
    .select("name")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .order("name");
  return (data ?? []).map((row) => row.name).filter(Boolean);
}
