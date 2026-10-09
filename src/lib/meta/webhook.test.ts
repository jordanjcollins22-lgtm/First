import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { insideReplyWindow, messagesIn, signatureOk } from "./webhook";

describe("signatureOk", () => {
  const body = JSON.stringify({ object: "page", entry: [] });
  const sign = (secret: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  it("accepts a delivery signed with the app secret", () => {
    expect(signatureOk(body, sign("s3cret"), "s3cret")).toBe(true);
  });

  it("refuses a wrong secret, a missing header or a tampered body", () => {
    expect(signatureOk(body, sign("other"), "s3cret")).toBe(false);
    expect(signatureOk(body, null, "s3cret")).toBe(false);
    expect(signatureOk(`${body} `, sign("s3cret"), "s3cret")).toBe(false);
  });
});

describe("messagesIn", () => {
  it("reads a Messenger message to the page", () => {
    const got = messagesIn({
      object: "page",
      entry: [{ id: "PAGE1", messaging: [{ sender: { id: "PSID9" }, recipient: { id: "PAGE1" }, timestamp: 1791500000000, message: { mid: "m1", text: " Hi, do you do mulch? " } }] }],
    });
    expect(got).toEqual([
      expect.objectContaining({ platform: "facebook", accountId: "PAGE1", contactId: "PSID9", direction: "in", mid: "m1", text: "Hi, do you do mulch?" }),
    ]);
  });

  it("keeps the page's own replies as outgoing, to the person they went to", () => {
    const [echo] = messagesIn({
      object: "instagram",
      entry: [{ id: "IG1", messaging: [{ sender: { id: "IG1" }, recipient: { id: "IGSID4" }, message: { mid: "m2", text: "Thanks!", is_echo: true } }] }],
    });
    expect(echo).toEqual(expect.objectContaining({ platform: "instagram", contactId: "IGSID4", direction: "out" }));
  });

  it("keeps a shared post's link", () => {
    const [shared] = messagesIn({
      object: "page",
      entry: [{ id: "P", messaging: [{ sender: { id: "S" }, message: { mid: "m3", attachments: [{ type: "share", payload: { url: "https://facebook.com/groups/1/posts/2" } }] } }] }],
    });
    expect(shared.attachments[0]).toEqual({ type: "share", url: "https://facebook.com/groups/1/posts/2", title: null });
  });

  it("ignores reads, deletions and anything that isn't a page or Instagram", () => {
    expect(messagesIn({ object: "page", entry: [{ id: "P", messaging: [{ sender: { id: "S" }, read: { watermark: 1 } }] }] })).toEqual([]);
    expect(messagesIn({ object: "page", entry: [{ id: "P", messaging: [{ sender: { id: "S" }, message: { mid: "x", is_deleted: true } }] }] })).toEqual([]);
    expect(messagesIn({ object: "user", entry: [] })).toEqual([]);
  });
});

describe("insideReplyWindow", () => {
  const now = new Date("2026-10-09T12:00:00Z");
  it("is open for 24 hours after their last message", () => {
    expect(insideReplyWindow(new Date("2026-10-08T13:00:00Z"), now)).toBe(true);
    expect(insideReplyWindow(new Date("2026-10-08T11:00:00Z"), now)).toBe(false);
    expect(insideReplyWindow(null, now)).toBe(false);
  });
});
