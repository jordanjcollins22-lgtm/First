import Anthropic from "@anthropic-ai/sdk";

import type { createClient } from "@/lib/supabase/server";
import type { createAdminClient } from "@/lib/supabase/admin";
import { env, isAnthropicConfigured } from "@/lib/env";
import { checkComment, commentBrief, commentSystemPrompt, replyBrief, replySystemPrompt, LINK_MARKER } from "@/lib/comment-prompt";
import { readingBrief } from "@/lib/post-reading";
import { parseReadAndDraft, readAndDraftSystemPrompt } from "@/lib/read-and-draft";
import type { ReadAndDraftResult } from "@/lib/actions/outreach-link-actions";
import type { OutreachKind } from "@/lib/outreach-links";

type Db = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>;

/**
 * Read a post and write the comment for it, in one go.
 *
 * The same reading and the same writing the Posts to Answer card has always
 * used, with who is asking passed in rather than read from the session: the
 * board writes comments the moment a post is sorted, which can happen on a
 * timer with nobody signed in. `roles` decides the opener ("I work with...",
 * "I do the evaluations for..."); the board writes with none, the neutral
 * opener, and swaps in the taker's own when they use it.
 */
export async function readAndDraftFor(
  input: {
    screenshotPath: string | null;
    pastedText?: string;
    kind: OutreachKind;
    ageDays?: number | null;
  },
  ctx: { supabase: Db; organizationId: string; organizationName: string; roles: readonly string[] }
): Promise<ReadAndDraftResult> {
  if (!isAnthropicConfigured) return { ok: false, error: "Reading posts isn't set up on this site yet." };
  if (!input.screenshotPath && !input.pastedText?.trim()) return { ok: false, error: "Nothing to read." };

  try {
    const { supabase } = ctx;
    const organization = { id: ctx.organizationId, name: ctx.organizationName };
    const { data: serviceRows } = await supabase
      .from("services")
      .select("name, status, performed_by")
      .eq("organization_id", organization.id);
    const live = (serviceRows ?? []).filter((row) => row.status !== "archived");
    const services = live.filter((row) => row.status === "active").map((row) => row.name).filter(Boolean).sort();
    const ownServices = live.filter((row) => row.performed_by !== "partner" && row.status === "active").map((row) => row.name).filter(Boolean);
    const partnerServices = live.filter((row) => row.performed_by === "partner").map((row) => row.name).filter(Boolean);

    const content: Anthropic.ContentBlockParam[] = [];
    if (input.screenshotPath) {
      const { data: file } = await supabase.storage.from("recommendation-shots").download(input.screenshotPath);
      if (file) {
        const type = file.type === "image/png" || file.type === "image/webp" ? file.type : "image/jpeg";
        content.push({ type: "image", source: { type: "base64", media_type: type, data: Buffer.from(await file.arrayBuffer()).toString("base64") } });
      }
    }
    const isMessage = input.kind === "dm";
    content.push({
      type: "text",
      text: [
        readingBrief({ pastedText: input.pastedText ?? "", note: "" }),
        "",
        isMessage
          ? replyBrief({ note: "", ownServices, partnerServices })
          : commentBrief({ businessName: organization.name, note: "", where: "", ageDays: input.ageDays ?? null, ownServices, partnerServices }),
      ].join("\n"),
    });

    const client = new Anthropic({ apiKey: env.anthropicApiKey });
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 1600,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: readAndDraftSystemPrompt({
        reading: { groupName: "", services, blockWords: [] },
        writing: isMessage
          ? replySystemPrompt(organization.name, { own: ownServices, partner: partnerServices }, ctx.roles)
          : commentSystemPrompt(organization.name, { own: ownServices, partner: partnerServices }, ctx.roles),
        what: isMessage ? "reply" : "comment",
      }),
      messages: [{ role: "user", content }],
    });
    if (response.stop_reason === "refusal") return { ok: false, error: "Couldn't read that one. Fill it in and carry on." };

    const raw = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    const { reading, comment } = parseReadAndDraft(raw, services, isMessage ? "reply" : "comment");
    if (!reading) return { ok: false, error: "Couldn't read that one. Fill it in and carry on." };

    // Checked now, before anybody can copy it, the same as before.
    let draft: string | null = null;
    let draftNote: string | null = null;
    if (comment) {
      const check = checkComment(comment.replace(LINK_MARKER, ""));
      if (check.ok) draft = comment;
      else {
        console.error("comment draft refused:", check.problems, comment);
        draftNote = `Wouldn't send that one. ${check.problems.join(" ")} Use a wording below.`;
      }
    } else if (reading.kind === "request") {
      draftNote = "Couldn't write one for that post. The wordings below still work.";
    }

    return {
      ok: true,
      platform: reading.platform,
      groupName: reading.groupName,
      askedBy: reading.author,
      note: [reading.service, reading.summary].filter(Boolean).join(", "),
      ageDays: reading.ageDays,
      worthAnswering: reading.kind === "request",
      kind: reading.kind,
      service: reading.service,
      draft,
      draftNote,
    };
  } catch (err) {
    console.error("read and draft failed:", err);
    return { ok: false, error: "Couldn't read that one. Fill it in and carry on." };
  }
}
