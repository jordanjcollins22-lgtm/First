import { discordWhoAmI } from "@/lib/fixit/discord-api";
import type { IntegrationProvider } from "@/lib/integrations/types";

/**
 * The owner's fix-it bot: slash commands typed in a Discord channel save
 * tickets (/fixit), list them (/sum), queue a build of them (/build) and
 * approve or send back the result. Discord calls the app at
 * /api/discord/interactions, signed with the application's key; the app
 * posts each finished build back through the channel's webhook.
 */
export const discordProvider: IntegrationProvider = {
  id: "discord",
  name: "Discord (fix-it tickets)",
  area: "Admin",
  enables: "Fix-it tickets from a Discord channel: /fixit with a screenshot, /sum, /build, /approve and /sendback.",
  fields: [
    { key: "application_id", label: "Application ID", placeholder: "123456789012345678", help: "Developer Portal › your application › General Information." },
    { key: "public_key", label: "Public Key", placeholder: "64 hex characters", help: "Same page, under Application ID." },
    { key: "bot_token", label: "Bot token", secret: true, help: "Bot › Reset Token. Shown once by Discord." },
    { key: "webhook_url", label: "Channel webhook URL", secret: true, placeholder: "https://discord.com/api/webhooks/…", help: "Where build summaries are posted." },
    { key: "guild_id", label: "Server ID (optional)", placeholder: "Only take commands from this server", help: "Right-click the server › Copy Server ID (Developer Mode on)." },
    { key: "channel_id", label: "Channel ID (optional)", placeholder: "Only take commands from this channel", help: "Right-click the channel › Copy Channel ID." },
  ],
  howTo: [
    "Go to discord.com/developers/applications and press New Application. Name it (e.g. JS Fix-it).",
    "On General Information, copy the Application ID and the Public Key into the boxes here.",
    "Set Interactions Endpoint URL on that same page to https://app.jslandscapingmd.com/api/discord/interactions and save (save this card first, so the app knows the key Discord checks with).",
    "Open Bot, press Reset Token, and copy the token into Bot token here.",
    "Open OAuth2 › URL Generator, tick the scopes bot and applications.commands, open the URL it makes, and invite the bot to your server.",
    "In Discord, open the channel's settings › Integrations › Webhooks › New Webhook › Copy Webhook URL, and paste it here.",
    "Optional: with Developer Mode on (User Settings › Advanced), right-click the server and the channel to copy their IDs, so only that channel is listened to.",
    "Save, then press Register Discord commands under Admin › Settings › Fix-it tickets.",
  ],
  docsUrl: "https://discord.com/developers/docs/interactions/overview",
  async test(secrets, settings) {
    if (!secrets.bot_token) return { ok: false, error: "Add the bot token." };
    const appId = String(settings.application_id ?? "").trim();
    if (!appId) return { ok: false, error: "Add the Application ID." };
    if (!/^[0-9a-f]{64}$/i.test(String(settings.public_key ?? "").trim())) return { ok: false, error: "The Public Key should be 64 hex characters." };
    const me = await discordWhoAmI(secrets.bot_token);
    if (!me.ok) return me;
    if (me.id !== appId) return { ok: false, error: "That bot token belongs to a different application than the Application ID." };
    return { ok: true };
  },
};
