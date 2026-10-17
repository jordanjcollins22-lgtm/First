"use server";

import { revalidatePath } from "next/cache";

import { getRealProfile } from "@/lib/data/team";
import { FIXIT_COMMANDS } from "@/lib/fixit/commands";
import { putGlobalCommands } from "@/lib/fixit/discord-api";
import { approveLatestBuild, discordConfigForOrg, sendBackTicket } from "@/lib/fixit/store";
import { log } from "@/lib/log";
import { isOwnerLevel } from "@/lib/roles";

/**
 * The Fix-it tickets panel's buttons: the same as /approve and /sendback in
 * Discord, plus registering the slash commands. Owner only, checked against
 * the account actually signed in (never a "view as" switch).
 */

export type FixitResult = { ok: true; message: string } | { ok: false; error: string };

async function owner() {
  const me = await getRealProfile();
  if (!me || !isOwnerLevel(me.roles)) return null;
  return me;
}

const done = () => revalidatePath("/v2/admin");

/** Tells Discord about the five commands (replacing whatever the application had). */
export async function registerDiscordCommandsAction(): Promise<FixitResult> {
  const me = await owner();
  if (!me) return { ok: false, error: "Only an owner can register the Discord commands." };
  const config = await discordConfigForOrg(me.organization_id);
  if (!config) return { ok: false, error: "Save the Discord integration first (Application ID and Public Key)." };
  if (!config.botToken) return { ok: false, error: "Save the Discord bot token first." };
  try {
    const r = await putGlobalCommands(config.applicationId, config.botToken, FIXIT_COMMANDS);
    return r.ok ? { ok: true, message: "Registered /fixit, /sum, /build, /approve and /sendback. They can take a minute to show in Discord." } : r;
  } catch (err) {
    log.error("fixit.register_commands_failed", err);
    return { ok: false, error: "Couldn't reach Discord." };
  }
}

export async function approveFixitBuildAction(): Promise<FixitResult> {
  const me = await owner();
  if (!me) return { ok: false, error: "Only an owner can approve a build." };
  try {
    const r = await approveLatestBuild(me.organization_id);
    done();
    return r.ok ? { ok: true, message: `Build #${r.number} approved.` } : r;
  } catch (err) {
    log.error("fixit.approve_failed", err);
    return { ok: false, error: "Couldn't approve. Is migration 0368 applied?" };
  }
}

export async function sendBackFixitTicketAction(number: number, note: string): Promise<FixitResult> {
  const me = await owner();
  if (!me) return { ok: false, error: "Only an owner can send a ticket back." };
  try {
    const r = await sendBackTicket(me.organization_id, Number(number), String(note ?? ""));
    done();
    return r.ok ? { ok: true, message: `Ticket #${r.number} sent back.` } : r;
  } catch (err) {
    log.error("fixit.send_back_failed", err);
    return { ok: false, error: "Couldn't send it back." };
  }
}
