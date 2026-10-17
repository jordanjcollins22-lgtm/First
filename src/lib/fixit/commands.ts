/**
 * The five slash commands the owner types in Discord, and reading what
 * Discord sends when one is used. Plain data and pure functions: the route
 * (src/app/api/discord/interactions) and the "Register Discord commands"
 * button both use them.
 */

/** Discord's application command option types (only the ones used here). */
const STRING = 3;
const INTEGER = 4;
const ATTACHMENT = 11;

/** What PUT /applications/{id}/commands takes: the whole set, replacing any old one. */
export const FIXIT_COMMANDS = [
  {
    name: "fixit",
    type: 1,
    description: "Save a fix-it ticket: what's wrong, and a screenshot of it.",
    options: [
      { name: "description", description: "What's wrong, or what should change.", type: STRING, required: true, max_length: 4000 },
      { name: "screenshot", description: "A screenshot of the screen.", type: ATTACHMENT, required: true },
    ],
  },
  { name: "sum", type: 1, description: "List the open fix-it tickets." },
  { name: "build", type: 1, description: "Fix every open ticket in one build, with a preview to check." },
  { name: "approve", type: 1, description: "Put the latest ready build live." },
  {
    name: "sendback",
    type: 1,
    description: "Reopen one ticket with a note on what's still wrong.",
    options: [
      { name: "number", description: "The ticket number.", type: INTEGER, required: true, min_value: 1 },
      { name: "note", description: "What's still wrong.", type: STRING, required: true, max_length: 2000 },
    ],
  },
] as const;

export type FixitCommandName = (typeof FIXIT_COMMANDS)[number]["name"];
const NAMES = new Set<string>(FIXIT_COMMANDS.map((c) => c.name));

export interface DiscordAttachment {
  id: string;
  filename: string;
  size: number;
  url: string;
  contentType: string | null;
}

export type FixitCommand =
  | { name: "fixit"; description: string; screenshot: DiscordAttachment | null }
  | { name: "sum" }
  | { name: "build" }
  | { name: "approve" }
  | { name: "sendback"; number: number; note: string };

export type ParsedInteraction =
  | { kind: "ping" }
  | {
      kind: "command";
      applicationId: string;
      token: string;
      guildId: string | null;
      channelId: string | null;
      /** Who typed it, as a name for the ticket ("jordan (1234…)"). */
      user: string | null;
      command: FixitCommand | null;
      /** The command's name as sent, even when it isn't one of ours. */
      rawName: string;
    }
  | { kind: "other" };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** The application id an interaction claims to be for, read before its signature is checked so the right key can be found. */
export function applicationIdOf(body: unknown): string | null {
  return str(obj(body).application_id);
}

export function parseInteraction(body: unknown): ParsedInteraction {
  const b = obj(body);
  if (b.type === 1) return { kind: "ping" };
  if (b.type !== 2) return { kind: "other" };

  const data = obj(b.data);
  const rawName = str(data.name) ?? "";
  const options = Array.isArray(data.options) ? (data.options as Obj[]) : [];
  const option = (name: string) => options.find((o) => o.name === name)?.value;
  const author = obj(obj(b.member).user ?? b.user);
  const username = str(author.global_name) ?? str(author.username);
  const userId = str(author.id);

  let command: FixitCommand | null = null;
  if (NAMES.has(rawName)) {
    switch (rawName as FixitCommandName) {
      case "fixit": {
        const attachmentId = str(option("screenshot"));
        const resolved = attachmentId ? obj(obj(obj(data.resolved).attachments)[attachmentId]) : null;
        command = {
          name: "fixit",
          description: (str(option("description")) ?? "").trim(),
          screenshot: resolved && str(resolved.url)
            ? {
                id: attachmentId!,
                filename: str(resolved.filename) ?? "screenshot",
                size: typeof resolved.size === "number" ? resolved.size : 0,
                url: str(resolved.url)!,
                contentType: str(resolved.content_type),
              }
            : null,
        };
        break;
      }
      case "sendback": {
        const n = Number(option("number"));
        command = { name: "sendback", number: Number.isInteger(n) ? n : 0, note: (str(option("note")) ?? "").trim() };
        break;
      }
      default:
        command = { name: rawName as "sum" | "build" | "approve" };
    }
  }

  return {
    kind: "command",
    applicationId: str(b.application_id) ?? "",
    token: str(b.token) ?? "",
    guildId: str(b.guild_id),
    channelId: str(b.channel_id) ?? str(obj(b.channel).id),
    user: username ? (userId ? `${username} (${userId})` : username) : userId,
    command,
    rawName,
  };
}

/** Whether a command came from where the owner said it may (a blank setting allows anywhere). */
export function fromAllowedPlace(where: { guildId: string | null; channelId: string | null }, allowed: { guildId?: string | null; channelId?: string | null }): boolean {
  if (allowed.guildId && where.guildId !== allowed.guildId) return false;
  if (allowed.channelId && where.channelId !== allowed.channelId) return false;
  return true;
}

export const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
const SCREENSHOT_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

/** Only fetch from Discord's own file hosts, over https: the URL came in a request body. */
export function screenshotUrlOk(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && SCREENSHOT_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

/** The file extension for an image type we keep, or null for anything else. */
export function imageExtension(contentType: string | null | undefined): string | null {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return IMAGE_TYPES[type] ?? null;
}

/** What's wrong with an attachment before downloading it, or null when it looks fine. */
export function screenshotProblem(a: DiscordAttachment | null): string | null {
  if (!a) return "Attach a screenshot.";
  if (!screenshotUrlOk(a.url)) return "That screenshot isn't on Discord's file host.";
  if (a.contentType && !imageExtension(a.contentType)) return "The screenshot must be a PNG, JPEG, GIF or WebP image.";
  if (a.size > MAX_SCREENSHOT_BYTES) return "The screenshot is over 10 MB.";
  return null;
}
