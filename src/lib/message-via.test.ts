import { describe, expect, it } from "vitest";

import {
  clientMessageEmail,
  defaultVia,
  HOW_TO_REPLY,
  viaBubbleLabel,
  viaOptions,
  viaReachLine,
} from "./message-via";

const all = { phone: "410 555 0123", email: "jo@x.com", smsReady: true, emailReady: true, clientLink: "https://x/p/1" };

describe("viaOptions", () => {
  it("always lists the three ways in the same order", () => {
    expect(viaOptions(all).map((o) => o.via)).toEqual(["app", "email", "sms"]);
    expect(viaOptions({ ...all, phone: null, email: null }).map((o) => o.via)).toEqual(["app", "email", "sms"]);
  });

  it("greys a text out with the reason when no text line is connected", () => {
    const sms = viaOptions({ ...all, smsReady: false }).find((o) => o.via === "sms")!;
    expect(sms.available).toBe(false);
    expect(sms.reason).toMatch(/no text line/i);
  });

  it("greys a text out when there is no number to send it to", () => {
    const sms = viaOptions({ ...all, phone: " " }).find((o) => o.via === "sms")!;
    expect(sms.available).toBe(false);
    expect(sms.reason).toMatch(/no phone/i);
  });

  it("greys email out for the right reason", () => {
    expect(viaOptions({ ...all, emailReady: false }).find((o) => o.via === "email")!.reason).toMatch(/not connected/i);
    expect(viaOptions({ ...all, email: null }).find((o) => o.via === "email")!.reason).toMatch(/no email/i);
  });

  it("the app is always there", () => {
    expect(viaOptions({ phone: null, email: null, smsReady: false, emailReady: false, clientLink: null })[0]).toMatchObject({
      via: "app",
      available: true,
    });
  });
});

describe("defaultVia", () => {
  it("starts on email when it can", () => {
    expect(defaultVia(all)).toBe("email");
  });
  it("falls to a text, then to the app", () => {
    expect(defaultVia({ ...all, email: null })).toBe("sms");
    expect(defaultVia({ ...all, email: null, smsReady: false })).toBe("app");
  });
});

describe("viaReachLine", () => {
  it("names the address an email goes to and how they can answer", () => {
    const line = viaReachLine("email", all);
    expect(line).toContain("jo@x.com");
    expect(line).toMatch(/project page/);
  });
  it("warns that a text is cut short", () => {
    expect(viaReachLine("sms", all)).toContain("410 555 0123");
    expect(viaReachLine("sms", all)).toMatch(/cut short/);
  });
  it("says an app message with no proposal out reaches nobody", () => {
    expect(viaReachLine("app", { ...all, clientLink: null })).toMatch(/no page to read it on/i);
    expect(viaReachLine("app", all)).toMatch(/not told/);
  });
  it("uses no dashes", () => {
    for (const via of ["app", "email", "sms"] as const) {
      expect(viaReachLine(via, all)).not.toMatch(/[—–]/);
    }
    expect(HOW_TO_REPLY).not.toMatch(/[—–]/);
  });
});

describe("viaBubbleLabel", () => {
  it("says how each one went", () => {
    expect(viaBubbleLabel("email")).toBe("Email");
    expect(viaBubbleLabel("sms")).toBe("Text");
    expect(viaBubbleLabel("app")).toBe("App message");
    expect(viaBubbleLabel(null)).toBe("App message");
  });
});

describe("clientMessageEmail", () => {
  it("is signed, addressed, and says how to write back", () => {
    const mail = clientMessageEmail({
      businessName: "JS Landscaping MD",
      clientName: "Linda Holden",
      body: "We can come Tuesday.",
      address: "12 Oak St",
      link: "https://x/p/1",
    });
    expect(mail.subject).toBe("A message from JS Landscaping MD about 12 Oak St");
    expect(mail.text.startsWith("Hi Linda,")).toBe(true);
    expect(mail.text).toContain("We can come Tuesday.");
    expect(mail.text).toContain("https://x/p/1");
    expect(mail.text).toContain(HOW_TO_REPLY);
    expect(mail.text.trim().endsWith("JS Landscaping MD")).toBe(true);
  });

  it("copes with no name, no address and no page", () => {
    const mail = clientMessageEmail({ businessName: "", clientName: null, body: "Hello", address: null, link: null });
    expect(mail.subject).toBe("A message from Your crew");
    expect(mail.text.startsWith("Hi,")).toBe(true);
    expect(mail.text).not.toContain("project page:");
  });
});
