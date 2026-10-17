import { imageExtension, MAX_SCREENSHOT_BYTES, screenshotProblem, screenshotUrlOk, type DiscordAttachment, type FixitCommand } from "@/lib/fixit/commands";
import { buildQueuedMessage, ticketListMessage, ticketSavedMessage } from "@/lib/fixit/messages";
import { approveLatestBuild, createTicket, listOpenTickets, queueBuild, sendBackTicket, storeScreenshot } from "@/lib/fixit/store";

/**
 * Does what a slash command asks and returns the bot's reply. Runs after
 * Discord has been told "thinking…", so it may take more than the 3 seconds
 * an interaction gets. Server only.
 */
export async function runFixitCommand(organizationId: string, command: FixitCommand, user: string | null): Promise<string> {
  switch (command.name) {
    case "fixit": {
      if (!command.description) return "Say what's wrong in the description.";
      const problem = screenshotProblem(command.screenshot);
      if (problem) return problem;
      const shot = await downloadScreenshot(command.screenshot!);
      if (!shot.ok) return shot.error;
      const stored = await storeScreenshot(organizationId, shot.bytes, shot.contentType, shot.extension);
      const number = await createTicket(organizationId, {
        description: command.description.slice(0, 4000),
        screenshotPath: stored.path,
        screenshotUrl: stored.url,
        discordUser: user,
      });
      return ticketSavedMessage(number);
    }
    case "sum": {
      const tickets = await listOpenTickets(organizationId);
      return ticketListMessage(tickets);
    }
    case "build": {
      const r = await queueBuild(organizationId, user);
      return r.ok ? buildQueuedMessage(r.number, r.tickets) : r.error;
    }
    case "approve": {
      const r = await approveLatestBuild(organizationId);
      return r.ok ? `Build #${r.number} approved. It goes live once the job merges it.` : r.error;
    }
    case "sendback": {
      const r = await sendBackTicket(organizationId, command.number, command.note);
      return r.ok ? `Ticket #${r.number} sent back. The next /build takes it with your note.` : r.error;
    }
  }
}

/**
 * Fetches the attachment from Discord's file host, refusing anything that
 * isn't an image or runs past 10 MB, whatever the attachment claimed.
 */
async function downloadScreenshot(a: DiscordAttachment): Promise<{ ok: true; bytes: ArrayBuffer; contentType: string; extension: string } | { ok: false; error: string }> {
  // Discord's CDN doesn't redirect; following one could leave its hosts.
  const res = await fetch(a.url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!res || !res.ok || !res.body) return { ok: false, error: "Couldn't download the screenshot from Discord. Try again." };
  if (!screenshotUrlOk(res.url || a.url)) return { ok: false, error: "That screenshot isn't on Discord's file host." };
  const contentType = (res.headers.get("content-type") ?? a.contentType ?? "").split(";")[0].trim().toLowerCase();
  const extension = imageExtension(contentType);
  if (!extension) return { ok: false, error: "The screenshot must be a PNG, JPEG, GIF or WebP image." };
  if (Number(res.headers.get("content-length") ?? 0) > MAX_SCREENSHOT_BYTES) return { ok: false, error: "The screenshot is over 10 MB." };

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_SCREENSHOT_BYTES) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, error: "The screenshot is over 10 MB." };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return { ok: true, bytes: bytes.buffer, contentType, extension };
}
