import Anthropic from "@anthropic-ai/sdk";
import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { env, isAnthropicConfigured, isSupabaseConfigured } from "@/lib/env";
import { ASSISTANT_TOOLS, runAssistantTool } from "@/lib/assistant-tools";

/**
 * Backs the "Ask Claude" chat. Unlike before, the assistant can now act on
 * client accounts — look a client up, update a job's status, dates, and notes,
 * and put it on the crew's Jobs calendar.
 *
 * The tools run with the signed-in user's Supabase client, so RLS decides what
 * it can touch; the assistant has no more reach than the person talking to it.
 *
 * This drives the tool loop by hand rather than using the SDK's tool runner:
 * a route handler wants a hard ceiling on iterations so one conversation can't
 * spin, and the loop is short enough that owning it costs nothing.
 */

// Enough for a lookup, a couple of edits, and the reply. If it hits this, the
// model gets told rather than the request hanging.
const MAX_TOOL_ROUNDS = 8;

function systemPrompt(today: string): string {
  return [
    "You are the assistant inside Celerity, a landscaping and property-estimating app used by this business's team.",
    "",
    `Today is ${today}. Use it to resolve relative dates — when someone says "Monday", "tomorrow", or "next week", work out the actual date and say which date you used so they can correct you.`,
    "",
    "You can act on client accounts through your tools: look a client up, change a job's status, dates, and notes, and put a job on the crew's Jobs calendar. When someone describes what happened on a job, make the changes rather than explaining how they could make them.",
    "",
    "Find the client first — you need the job id before you can change anything. If the name matches more than one client, ask which one instead of guessing. If it matches exactly one, go ahead.",
    "",
    "Work the way a careful colleague would: make the routine calls yourself, and check in only when two readings would lead to genuinely different changes. When work started but isn't finished, that's status 'in_progress' with the start date recorded and the return day set as the end date.",
    "",
    "Keep replies short. Say what you changed, in plain sentences — which job, which dates, what the crew will see. Don't list the tool calls you made or repeat the job id back.",
  ].join("\n");
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: "Supabase isn't configured yet." }, { status: 503 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const { data: profileRoles, error: rolesError } = await supabase
    .from("profile_roles")
    .select("role_name")
    .eq("profile_id", user.id);
  if (rolesError) {
    return NextResponse.json({ error: "Couldn't verify your account." }, { status: 500 });
  }
  const isAdmin = (profileRoles ?? []).some((r) => r.role_name === "admin");
  if (!isAdmin) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }

  if (!isAnthropicConfigured) {
    return NextResponse.json(
      { error: "The AI assistant isn't set up yet — add ANTHROPIC_API_KEY to the server environment." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);
  const incoming = Array.isArray(body?.messages) ? body.messages : [];
  if (incoming.length === 0) {
    return NextResponse.json({ error: "No message provided." }, { status: 400 });
  }

  const messages: Anthropic.MessageParam[] = incoming
    .filter(
      (m: unknown): m is { role: "user" | "assistant"; content: string } =>
        typeof m === "object" &&
        m !== null &&
        ((m as { role?: unknown }).role === "user" || (m as { role?: unknown }).role === "assistant") &&
        typeof (m as { content?: unknown }).content === "string"
    )
    .slice(-20)
    .map((m: { role: "user" | "assistant"; content: string }) => ({ role: m.role, content: m.content }));

  const client = new Anthropic({ apiKey: env.anthropicApiKey });
  const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local

  try {
    let rounds = 0;
    let response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      system: systemPrompt(today),
      tools: ASSISTANT_TOOLS,
      messages,
    });

    while (response.stop_reason === "tool_use" && rounds < MAX_TOOL_ROUNDS) {
      rounds += 1;

      const toolUses = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );

      // Run them together — the model asks for independent lookups in one turn
      // and serialising them just adds latency.
      const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolUses.map(async (call) => {
          const result = await runAssistantTool(call.name, (call.input ?? {}) as Record<string, unknown>);
          return {
            type: "tool_result" as const,
            tool_use_id: call.id,
            content: JSON.stringify(result),
            is_error: !result.ok,
          };
        })
      );

      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: results });

      response = await client.messages.create({
        model: "claude-opus-5",
        max_tokens: 8000,
        thinking: { type: "adaptive" },
        system: systemPrompt(today),
        tools: ASSISTANT_TOOLS,
        messages,
      });
    }

    if (response.stop_reason === "refusal") {
      return NextResponse.json({ reply: "I can't help with that one." });
    }

    const reply = response.content.find((block) => block.type === "text")?.text ?? "";

    if (!reply && rounds >= MAX_TOOL_ROUNDS) {
      return NextResponse.json({
        reply: "That turned into more steps than I can do in one go. Tell me the next single change and I'll make it.",
      });
    }

    return NextResponse.json({ reply });
  } catch (err) {
    console.error("admin-chat failed:", err);
    const message =
      err instanceof Anthropic.RateLimitError
        ? "The assistant is rate limited right now — try again in a moment."
        : "The AI request failed. Try again in a moment.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
