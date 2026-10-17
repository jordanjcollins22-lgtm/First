/**
 * The few Discord REST calls the fix-it bot makes. Server only. The bot
 * token and the webhook URL are secrets: they go in headers or as the
 * request URL and are never written to a log or an error message.
 */

export const DISCORD_API = "https://discord.com/api/v10";

type Result = { ok: true } | { ok: false; error: string };

// Nobody gets pinged by the bot, whatever a ticket says.
const NO_MENTIONS = { parse: [] as string[] };

async function failure(res: Response, what: string): Promise<{ ok: false; error: string }> {
  // Discord's error body names the problem ("401: Unauthorized", "Invalid Form Body"), never the token.
  let detail = "";
  try {
    const body = (await res.json()) as { message?: unknown };
    if (typeof body.message === "string") detail = `: ${body.message.slice(0, 200)}`;
  } catch {
    /* no body */
  }
  return { ok: false, error: `${what} (Discord said ${res.status}${detail})` };
}

/** Checks a bot token by asking Discord which application it belongs to. */
export async function discordWhoAmI(botToken: string): Promise<{ ok: true; id: string; name: string } | { ok: false; error: string }> {
  const res = await fetch(`${DISCORD_API}/applications/@me`, { headers: { Authorization: `Bot ${botToken}` }, cache: "no-store" });
  if (!res.ok) return failure(res, "The bot token didn't work");
  const body = (await res.json()) as { id?: string; name?: string };
  return { ok: true, id: String(body.id ?? ""), name: String(body.name ?? "") };
}

/** Replaces the application's global slash commands with exactly these. */
export async function putGlobalCommands(applicationId: string, botToken: string, commands: readonly unknown[]): Promise<Result> {
  const res = await fetch(`${DISCORD_API}/applications/${encodeURIComponent(applicationId)}/commands`, {
    method: "PUT",
    headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
    cache: "no-store",
  });
  return res.ok ? { ok: true } : failure(res, "Couldn't register the commands");
}

/** Fills in the "thinking…" reply a deferred interaction left in the channel. */
export async function editOriginalReply(applicationId: string, interactionToken: string, content: string): Promise<Result> {
  const res = await fetch(
    `${DISCORD_API}/webhooks/${encodeURIComponent(applicationId)}/${encodeURIComponent(interactionToken)}/messages/@original`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: content.slice(0, 2000), allowed_mentions: NO_MENTIONS }),
      cache: "no-store",
    }
  );
  return res.ok ? { ok: true } : failure(res, "Couldn't update the reply");
}

/** Only a Discord webhook address is ever posted to. */
export function webhookUrlOk(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && ["discord.com", "discordapp.com", "canary.discord.com", "ptb.discord.com"].includes(u.hostname) && u.pathname.startsWith("/api/webhooks/");
  } catch {
    return false;
  }
}

/** Posts one message (2,000 characters at most) to the channel's webhook. */
export async function postToWebhook(webhookUrl: string, content: string): Promise<Result> {
  if (!webhookUrlOk(webhookUrl)) return { ok: false, error: "The saved webhook URL isn't a Discord webhook." };
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: content.slice(0, 2000), allowed_mentions: NO_MENTIONS }),
    cache: "no-store",
  });
  return res.ok ? { ok: true } : failure(res, "Couldn't post to the channel");
}
