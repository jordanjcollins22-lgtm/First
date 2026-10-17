import { after, NextResponse, type NextRequest } from "next/server";

import { isSupabaseAdminConfigured } from "@/lib/env";
import { applicationIdOf, fromAllowedPlace, parseInteraction } from "@/lib/fixit/commands";
import { editOriginalReply } from "@/lib/fixit/discord-api";
import { runFixitCommand } from "@/lib/fixit/handle";
import { discordSignatureOk } from "@/lib/fixit/signature";
import { discordConfigForApplication } from "@/lib/fixit/store";
import { log } from "@/lib/log";

/**
 * Where Discord sends the owner's fix-it slash commands (/fixit, /sum,
 * /build, /approve, /sendback). Public: Discord has no session, so instead
 * every request must carry a valid Ed25519 signature from the application
 * saved under Admin › Settings › Integrations › Discord, and anything else
 * gets a 401 (Discord checks for that when the URL is saved).
 *
 * Discord wants an answer within 3 seconds. Every command is answered "the
 * bot is thinking…" straight away and done in after(), which then edits
 * that reply with the result: /fixit downloads and stores a screenshot,
 * which won't reliably fit in 3 seconds.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EPHEMERAL = 64;
const reply = (content: string, flags?: number) => NextResponse.json({ type: 4, data: { content, allowed_mentions: { parse: [] }, ...(flags ? { flags } : {}) } });

export async function POST(request: NextRequest) {
  if (!isSupabaseAdminConfigured) return NextResponse.json({ error: "Not configured." }, { status: 503 });
  const raw = await request.text();

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 401 });
  }

  // Which business, from the application id the request names; its saved
  // public key then decides whether the request is really from Discord.
  const config = await discordConfigForApplication(applicationIdOf(body) ?? "");
  const signed =
    config !== null &&
    discordSignatureOk(config.publicKey, request.headers.get("x-signature-ed25519"), request.headers.get("x-signature-timestamp"), raw);
  if (!config || !signed) {
    log.warn("discord.interaction.bad_signature", { known: Boolean(config) });
    return NextResponse.json({ error: "Invalid request signature." }, { status: 401 });
  }

  const interaction = parseInteraction(body);
  if (interaction.kind === "ping") return NextResponse.json({ type: 1 });
  if (interaction.kind !== "command") return NextResponse.json({ error: "Unsupported interaction." }, { status: 400 });

  if (!fromAllowedPlace(interaction, config)) return reply("Fix-it tickets are only taken in the business's own channel.", EPHEMERAL);
  if (!interaction.command) return reply(`/${interaction.rawName} isn't a fix-it command.`, EPHEMERAL);

  const { command, user, token, applicationId } = interaction;
  after(async () => {
    let content: string;
    try {
      content = await runFixitCommand(config.organizationId, command, user);
    } catch (err) {
      log.error("discord.interaction.failed", err, { command: command.name });
      content = "Something went wrong saving that. Try again in a minute.";
    }
    const edited = await editOriginalReply(applicationId, token, content).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : "fetch failed" }));
    if (!edited.ok) log.warn("discord.interaction.reply_failed", { command: command.name, error: edited.error });
  });

  // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: "JS Landscaping is thinking…"
  return NextResponse.json({ type: 5 });
}
