import { describe, expect, it } from "vitest";

import { domainOf, htmlToText, looksForged, replyText, senderAddress } from "@/lib/inbound-email";

describe("senderAddress", () => {
  it("takes the address out of a named sender", () => {
    expect(senderAddress("Sarah Miller <Sarah@Example.com>")).toBe("sarah@example.com");
  });
  it("takes a bare address as it is", () => {
    expect(senderAddress(" sarah@example.com ")).toBe("sarah@example.com");
  });
  it("refuses something that is not an address", () => {
    expect(senderAddress("Sarah Miller")).toBeNull();
    expect(senderAddress(null)).toBeNull();
  });
});

describe("domainOf", () => {
  it("is the part after the at sign", () => {
    expect(domainOf("office@send.jslandscapingmd.com")).toBe("send.jslandscapingmd.com");
  });
});

describe("replyText", () => {
  it("keeps the reply and drops the Gmail quote", () => {
    const text = "Yes, Tuesday works. Can you do the back beds too?\n\nOn Fri, Oct 3, 2026 at 2:14 PM JS Landscaping MD <office@send.jslandscapingmd.com> wrote:\n> Hi Sarah,\n> Your proposal is ready";
    expect(replyText(text)).toBe("Yes, Tuesday works. Can you do the back beds too?");
  });

  it("drops a quote whose wrote: line wraps", () => {
    const text = "Sounds good\n\nOn Fri, Oct 3, 2026 at 2:14 PM JS Landscaping MD <\noffice@send.jslandscapingmd.com> wrote:\n\n> Hi";
    expect(replyText(text)).toBe("Sounds good");
  });

  it("drops the phone signature", () => {
    expect(replyText("Thanks!\n\nSent from my iPhone\n\nOn Oct 3 wrote:")).toBe("Thanks!");
  });

  it("drops an Outlook original message", () => {
    expect(replyText("Approved.\n\n-----Original Message-----\nFrom: JS Landscaping")).toBe("Approved.");
  });

  it("reads the HTML when there is no text part", () => {
    expect(replyText(null, "<div>Can we start <b>Monday</b>?</div><blockquote>Hi Sarah</blockquote>")).toBe("Can we start Monday?");
  });

  it("shows a reply that is only a quote rather than nothing", () => {
    expect(replyText("> Hi Sarah\n> Your proposal")).toBe("> Hi Sarah\n> Your proposal");
  });
});

describe("htmlToText", () => {
  it("turns breaks into lines and decodes entities", () => {
    expect(htmlToText("<p>One &amp; two</p><p>Three<br>Four</p>")).toBe("One & two\nThree\nFour");
  });
});

describe("looksForged", () => {
  it("is forged only when SPF and DKIM both fail", () => {
    expect(looksForged({ spf: "fail", dkim: "fail" })).toBe(true);
    expect(looksForged({ spf: "fail", dkim: "pass" })).toBe(false);
    expect(looksForged(null)).toBe(false);
  });
});
