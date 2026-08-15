import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { env, isAnthropicConfigured, isSupabaseConfigured } from "@/lib/env";

/**
 * Backs the admin-only "Ask Claude" chat widget. Conversation only — no
 * tool use, no database access, no ability to change anything in the app.
 */
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
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (messages.length === 0) {
    return NextResponse.json({ error: "No message provided." }, { status: 400 });
  }

  const anthropicMessages = messages
    .filter(
      (m: unknown): m is { role: "user" | "assistant"; content: string } =>
        typeof m === "object" &&
        m !== null &&
        ((m as { role?: unknown }).role === "user" || (m as { role?: unknown }).role === "assistant") &&
        typeof (m as { content?: unknown }).content === "string"
    )
    .slice(-20);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      system:
        "You are a helpful assistant embedded in Celerity, a landscaping/property-estimating app used internally by this business's admins. Answer questions directly and concisely. You are conversation-only — you have no access to this app's live data and cannot make any changes to it.",
      messages: anthropicMessages,
    }),
  });

  if (!res.ok) {
    return NextResponse.json({ error: "The AI request failed. Try again in a moment." }, { status: 502 });
  }

  const data = await res.json();
  const reply = data.content?.find((block: { type?: string }) => block.type === "text")?.text ?? "";
  return NextResponse.json({ reply });
}
