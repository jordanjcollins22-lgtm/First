import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";

import { FIXIT_COMMANDS, applicationIdOf, fromAllowedPlace, imageExtension, parseInteraction, screenshotProblem, screenshotUrlOk } from "@/lib/fixit/commands";
import { webhookUrlOk } from "@/lib/fixit/discord-api";
import { buildQueuedMessage, buildReadyMessages, firstLine, resultLine, splitMessage, ticketListMessage } from "@/lib/fixit/messages";
import { discordSignatureOk } from "@/lib/fixit/signature";

describe("Discord's request signature", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  // The last 32 bytes of the SPKI form are the raw key the Developer Portal shows as hex.
  const publicHex = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
  const body = JSON.stringify({ type: 1, application_id: "123456789012345678" });
  const timestamp = "1700000000";
  const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString("hex");

  it("accepts a request signed with the application's key", () => {
    expect(discordSignatureOk(publicHex, signature, timestamp, body)).toBe(true);
  });

  it("refuses a changed body, timestamp or key, and anything missing", () => {
    expect(discordSignatureOk(publicHex, signature, timestamp, body + " ")).toBe(false);
    expect(discordSignatureOk(publicHex, signature, "1700000001", body)).toBe(false);
    const other = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
    expect(discordSignatureOk(other, signature, timestamp, body)).toBe(false);
    expect(discordSignatureOk(publicHex, null, timestamp, body)).toBe(false);
    expect(discordSignatureOk(publicHex, signature, null, body)).toBe(false);
    expect(discordSignatureOk("not-a-key", signature, timestamp, body)).toBe(false);
    expect(discordSignatureOk(publicHex, "zz".repeat(64), timestamp, body)).toBe(false);
  });
});

describe("reading an interaction", () => {
  it("knows a ping", () => {
    expect(parseInteraction({ type: 1 })).toEqual({ kind: "ping" });
    expect(applicationIdOf({ type: 1, application_id: "42" })).toBe("42");
  });

  it("reads /fixit with its screenshot", () => {
    const parsed = parseInteraction({
      type: 2,
      application_id: "app",
      token: "tok",
      guild_id: "g1",
      channel_id: "c1",
      member: { user: { id: "u1", username: "jordan", global_name: "Jordan" } },
      data: {
        name: "fixit",
        options: [
          { name: "description", type: 3, value: "  The save button is hidden\nOn the phone  " },
          { name: "screenshot", type: 11, value: "a1" },
        ],
        resolved: { attachments: { a1: { id: "a1", filename: "shot.png", size: 1234, url: "https://cdn.discordapp.com/attachments/1/2/shot.png", content_type: "image/png" } } },
      },
    });
    expect(parsed).toMatchObject({
      kind: "command",
      applicationId: "app",
      token: "tok",
      guildId: "g1",
      channelId: "c1",
      user: "Jordan (u1)",
      command: {
        name: "fixit",
        description: "The save button is hidden\nOn the phone",
        screenshot: { id: "a1", filename: "shot.png", size: 1234, url: "https://cdn.discordapp.com/attachments/1/2/shot.png", contentType: "image/png" },
      },
    });
  });

  it("reads /sendback's number and note, and the plain commands", () => {
    const sendback = parseInteraction({ type: 2, data: { name: "sendback", options: [{ name: "number", value: 7 }, { name: "note", value: " still wrong " }] } });
    expect(sendback).toMatchObject({ command: { name: "sendback", number: 7, note: "still wrong" } });
    expect(parseInteraction({ type: 2, data: { name: "sum" } })).toMatchObject({ command: { name: "sum" } });
    expect(parseInteraction({ type: 2, data: { name: "nope" } })).toMatchObject({ kind: "command", command: null, rawName: "nope" });
    expect(parseInteraction({ type: 3 })).toEqual({ kind: "other" });
  });

  it("registers five commands with the right option types", () => {
    expect(FIXIT_COMMANDS.map((c) => c.name)).toEqual(["fixit", "sum", "build", "approve", "sendback"]);
    const fixit = FIXIT_COMMANDS[0].options.map((o) => [o.name, o.type, o.required]);
    expect(fixit).toEqual([["description", 3, true], ["screenshot", 11, true]]);
    const sendback = FIXIT_COMMANDS[4].options.map((o) => [o.name, o.type]);
    expect(sendback).toEqual([["number", 4], ["note", 3]]);
  });

  it("only takes commands from the configured server and channel", () => {
    expect(fromAllowedPlace({ guildId: "g", channelId: "c" }, {})).toBe(true);
    expect(fromAllowedPlace({ guildId: "g", channelId: "c" }, { guildId: "g", channelId: "c" })).toBe(true);
    expect(fromAllowedPlace({ guildId: "x", channelId: "c" }, { guildId: "g" })).toBe(false);
    expect(fromAllowedPlace({ guildId: "g", channelId: "x" }, { channelId: "c" })).toBe(false);
    expect(fromAllowedPlace({ guildId: null, channelId: "c" }, { guildId: "g" })).toBe(false);
  });
});

describe("screenshots", () => {
  it("only fetches from Discord's file hosts", () => {
    expect(screenshotUrlOk("https://cdn.discordapp.com/attachments/1/2/a.png")).toBe(true);
    expect(screenshotUrlOk("https://media.discordapp.net/attachments/1/2/a.png")).toBe(true);
    expect(screenshotUrlOk("http://cdn.discordapp.com/a.png")).toBe(false);
    expect(screenshotUrlOk("https://cdn.discordapp.com.evil.test/a.png")).toBe(false);
    expect(screenshotUrlOk("https://169.254.169.254/latest")).toBe(false);
    expect(screenshotUrlOk("not a url")).toBe(false);
  });

  it("keeps images only, up to 10 MB", () => {
    expect(imageExtension("image/png")).toBe("png");
    expect(imageExtension("image/jpeg; charset=binary")).toBe("jpg");
    expect(imageExtension("text/html")).toBeNull();
    const ok = { id: "1", filename: "a.png", size: 100, url: "https://cdn.discordapp.com/a.png", contentType: "image/png" };
    expect(screenshotProblem(ok)).toBeNull();
    expect(screenshotProblem(null)).toMatch(/Attach/);
    expect(screenshotProblem({ ...ok, contentType: "application/pdf" })).toMatch(/PNG/);
    expect(screenshotProblem({ ...ok, size: 11 * 1024 * 1024 })).toMatch(/10 MB/);
    expect(screenshotProblem({ ...ok, url: "https://example.com/a.png" })).toMatch(/file host/);
  });

  it("only posts to a Discord webhook address", () => {
    expect(webhookUrlOk("https://discord.com/api/webhooks/1/abc")).toBe(true);
    expect(webhookUrlOk("https://discord.com/channels/1")).toBe(false);
    expect(webhookUrlOk("https://example.com/api/webhooks/1/abc")).toBe(false);
  });
});

describe("what the bot says", () => {
  it("lists open tickets by number, first line and status", () => {
    expect(ticketListMessage([])).toBe("No open tickets.");
    expect(
      ticketListMessage([
        { number: 1, description: "Button hidden\nmore detail", status: "open" },
        { number: 2, description: "Wrong total", status: "sent_back" },
      ])
    ).toBe("2 open tickets:\n#1 — Button hidden (open)\n#2 — Wrong total (sent back)");
    expect(firstLine("x".repeat(150))).toHaveLength(100);
  });

  it("says how many tickets a build took", () => {
    expect(buildQueuedMessage(3, 1)).toBe("Build #3 queued: 1 ticket. I'll post the summary and preview here when it's ready.");
    expect(buildQueuedMessage(4, 5)).toContain("5 tickets.");
  });

  it("splits long text on line breaks, never past the limit", () => {
    const text = Array.from({ length: 300 }, (_, i) => `line ${i} ${"word ".repeat(5)}`).join("\n");
    const parts = splitMessage(text, 2000);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(2000);
    expect(parts.join("\n").replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " ").trim());
    // One unbroken word longer than the limit is cut anyway.
    expect(splitMessage("x".repeat(4500), 2000).map((p) => p.length)).toEqual([2000, 2000, 500]);
  });

  it("posts a ready build with its preview, each ticket and what to do next", () => {
    const [message, ...rest] = buildReadyMessages({ number: 2, status: "ready", summary: "Fixed two things.", previewUrl: "https://preview.test" }, [
      { number: 4, description: "a", status: "fixed", result: "Moved the button" },
      { number: 5, description: "b", status: "question", result: "Which page?" },
    ]);
    expect(rest).toEqual([]);
    expect(message).toContain("Build #2 is ready.");
    expect(message).toContain("Preview: https://preview.test");
    expect(message).toContain("#4 — fixed: Moved the button");
    expect(message).toContain("#5 — question: Which page?");
    expect(message).toContain("Reply /approve to put it live, or /sendback number note to redo one");
    expect(resultLine({ number: 9, description: "", status: "fixed" })).toBe("#9 — fixed");
  });

  it("splits a long summary across messages", () => {
    const messages = buildReadyMessages({ number: 1, status: "ready", summary: "Long. ".repeat(800), previewUrl: null }, []);
    expect(messages.length).toBeGreaterThan(1);
    for (const m of messages) expect(m.length).toBeLessThanOrEqual(2000);
    expect(messages.at(-1)).toContain("/approve");
  });

  it("says a failed build put nothing live", () => {
    const [message] = buildReadyMessages({ number: 3, status: "failed", summary: "Tests failed.", previewUrl: null }, []);
    expect(message).toContain("Build #3 failed.");
    expect(message).toContain("Nothing went live");
    expect(message).not.toContain("/approve");
  });
});
