import { describe, expect, it } from "vitest";

import { countFunnel, targetFor } from "@/lib/hiring/volume";

describe("targetFor", () => {
  it("works back from 40 interviews a hire", () => {
    expect(targetFor(1)).toEqual({ hires: 1, interviews: 40, videos: 67, applications: 192 });
    expect(targetFor(2).interviews).toBe(80);
  });
});

describe("countFunnel", () => {
  it("counts each applicant at every step they reached", () => {
    expect(countFunnel(["screened_out", "video_requested", "video_submitted", "interview", "hired"])).toEqual({
      applications: 5,
      passed: 4,
      videos: 3,
      interviews: 2,
      hires: 1,
    });
  });
});
