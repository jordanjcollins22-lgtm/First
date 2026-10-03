import { describe, expect, it } from "vitest";

import { SCAN_MAX_FRAMES, scanFramePath, scanFrameSize, scanFrameTimes } from "@/lib/scan-frames";

describe("stills from a property video", () => {
  it("takes two a second of a normal walk, evenly spaced, skipping the fumbled ends", () => {
    const t = scanFrameTimes(60);
    expect(t.length).toBe(118);
    expect(t[0]).toBe(0.5);
    expect(t[t.length - 1]).toBe(59.5);
    expect(t[1] - t[0]).toBeCloseTo(0.5, 1);
  });

  it("caps a long video", () => {
    expect(scanFrameTimes(600).length).toBe(SCAN_MAX_FRAMES);
  });

  it("still takes enough from a short one", () => {
    expect(scanFrameTimes(10).length).toBe(30);
    expect(scanFrameTimes(0)).toEqual([]);
    expect(scanFrameTimes(Number.NaN)).toEqual([]);
  });

  it("shrinks a 4K frame to 1600 on its long side and leaves a small one alone", () => {
    expect(scanFrameSize(3840, 2160)).toEqual({ width: 1600, height: 900 });
    expect(scanFrameSize(2160, 3840)).toEqual({ width: 900, height: 1600 });
    expect(scanFrameSize(1280, 720)).toEqual({ width: 1280, height: 720 });
  });

  it("names the stills in order", () => {
    expect(scanFramePath("job", "scan", 0)).toBe("job/scans/scan/frame-0001.jpg");
  });
});
