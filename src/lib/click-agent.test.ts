import { describe, expect, it } from "vitest";

import { classifyAgent, countsAsOpen } from "./click-agent";

const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const FB_APP = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/470.0.0.0;]";

describe("classifyAgent", () => {
  it("knows a phone, in or out of the Facebook app", () => {
    expect(classifyAgent(PHONE)).toBe("browser");
    expect(classifyAgent(FB_APP)).toBe("browser");
  });

  it("knows the crawlers that fetch a link the moment it is posted", () => {
    expect(classifyAgent("facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)")).toBe("crawler");
    expect(classifyAgent("meta-externalagent/1.1")).toBe("crawler");
    expect(classifyAgent("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe("crawler");
    expect(classifyAgent("WhatsApp/2.23.20.0")).toBe("crawler");
    expect(classifyAgent("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 HeadlessChrome/120.0")).toBe("crawler");
  });

  it("knows a script and an empty header", () => {
    expect(classifyAgent("curl/8.4.0")).toBe("script");
    expect(classifyAgent("python-requests/2.31")).toBe("script");
    expect(classifyAgent("")).toBe("unknown");
    expect(classifyAgent(null)).toBe("unknown");
  });
});

describe("countsAsOpen", () => {
  it("counts only a person's browser asking for the page", () => {
    expect(countsAsOpen("GET", PHONE)).toBe(true);
    expect(countsAsOpen("HEAD", PHONE)).toBe(false);
    expect(countsAsOpen("GET", "facebookexternalhit/1.1")).toBe(false);
    expect(countsAsOpen("GET", "")).toBe(false);
  });
});
