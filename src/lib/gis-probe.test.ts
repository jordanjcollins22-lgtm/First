import { afterEach, describe, expect, it, vi } from "vitest";

import { describeOrigin } from "@/lib/gis-probe";

/**
 * Where a request ran from is the first question when the county does not
 * answer, so the answer has to be read off the environment, not guessed.
 */
describe("describeOrigin", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("knows a Vercel function, and which region and environment", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL_REGION", "iad1");
    expect(describeOrigin("server-action")).toMatchObject({
      platform: "vercel",
      environment: "production",
      region: "iad1",
      runtime: "server-action",
    });
  });

  it("knows the sandbox by its egress proxy", () => {
    // The proxy is what refuses the county host with a 403 on CONNECT. A
    // failure recorded from here is about the sandbox, not the county.
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("HTTPS_PROXY", "http://127.0.0.1:43391");
    expect(describeOrigin("background-job").platform).toBe("sandbox");
  });

  it("is local otherwise", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("HTTPS_PROXY", "");
    expect(describeOrigin("route-handler").platform).toBe("local");
  });
});
