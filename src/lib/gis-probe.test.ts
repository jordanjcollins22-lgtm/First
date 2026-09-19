import { afterEach, describe, expect, it, vi } from "vitest";

import { describeOrigin, serverEnvDiagnostic } from "@/lib/gis-probe";

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

describe("serverEnvDiagnostic", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("says the secret is there, and how long, and never what it is", () => {
    vi.stubEnv("CRON_SECRET", "s3cr3t-value");
    const report = serverEnvDiagnostic("route-handler");
    expect(report.cronSecretPresent).toBe(true);
    expect(report.cronSecretLength).toBe(12);
    expect(report.origin.cronSecretPresent).toBe(true);
    expect(JSON.stringify(report)).not.toContain("s3cr3t");
  });

  it("treats a blank value as absent but shows its length", () => {
    // Pasted as three spaces: "set" in the dashboard, useless in the process.
    vi.stubEnv("CRON_SECRET", "   ");
    const report = serverEnvDiagnostic("page-render");
    expect(report.cronSecretPresent).toBe(false);
    expect(report.cronSecretLength).toBe(3);
  });

  it("lists near-miss names so a typo is visible", () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("CRON_SECRET_KEY", "x");
    const report = serverEnvDiagnostic("page-render");
    expect(report.cronSecretPresent).toBe(false);
    expect(report.cronLikeNames).toContain("CRON_SECRET_KEY");
  });
});
