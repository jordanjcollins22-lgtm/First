import { describe, expect, it } from "vitest";

import { PREVIEW, THUMBNAIL, publicStorageUrl } from "@/lib/storage-image-url";

const SUPABASE_URL = "https://abcdefgh.supabase.co";

describe("publicStorageUrl", () => {
  it("points at the plain object when no size is asked for", () => {
    expect(publicStorageUrl({ supabaseUrl: SUPABASE_URL, bucket: "canvas-images", path: "job-1/front.jpg" })).toBe(
      "https://abcdefgh.supabase.co/storage/v1/object/public/canvas-images/job-1/front.jpg"
    );
  });

  it("matches what the Supabase client builds, so cached images keep their URL", () => {
    // getPublicUrl encodes the whole URL rather than each segment, and puts
    // the bucket in front of the path. Diverging from it by a single
    // character would re-download every image already sitting in a cache.
    expect(publicStorageUrl({ supabaseUrl: SUPABASE_URL, bucket: "canvas-images", path: "job 1/front side.jpg" })).toBe(
      "https://abcdefgh.supabase.co/storage/v1/object/public/canvas-images/job%201/front%20side.jpg"
    );
  });

  it("routes through the renderer once a size is asked for", () => {
    expect(
      publicStorageUrl({
        supabaseUrl: SUPABASE_URL,
        bucket: "canvas-images",
        path: "job-1/front.jpg",
        transform: { width: 320, quality: 60 },
      })
    ).toBe(
      "https://abcdefgh.supabase.co/storage/v1/render/image/public/canvas-images/job-1/front.jpg?width=320&quality=60"
    );
  });

  it("passes height and resize mode through", () => {
    expect(
      publicStorageUrl({
        supabaseUrl: SUPABASE_URL,
        bucket: "canvas-images",
        path: "a.jpg",
        transform: { width: 96, height: 96, resize: "cover" },
      })
    ).toBe(
      "https://abcdefgh.supabase.co/storage/v1/render/image/public/canvas-images/a.jpg?width=96&height=96&resize=cover"
    );
  });

  it("treats an empty transform as no transform", () => {
    // Otherwise a caller passing an object it built conditionally would send
    // the request through the renderer for nothing.
    expect(publicStorageUrl({ supabaseUrl: SUPABASE_URL, bucket: "b", path: "a.jpg", transform: {} })).toBe(
      "https://abcdefgh.supabase.co/storage/v1/object/public/b/a.jpg"
    );
  });

  it("keeps quality inside the range the renderer accepts", () => {
    // Out of range is a 400 from Supabase, which shows up as a broken image
    // rather than as an error anybody sees.
    const tooLow = publicStorageUrl({ supabaseUrl: SUPABASE_URL, bucket: "b", path: "a.jpg", transform: { quality: 1 } });
    const tooHigh = publicStorageUrl({ supabaseUrl: SUPABASE_URL, bucket: "b", path: "a.jpg", transform: { quality: 400 } });
    expect(tooLow).toContain("quality=20");
    expect(tooHigh).toContain("quality=100");
  });

  it("rounds a fractional width, because a device pixel ratio produces those", () => {
    const url = publicStorageUrl({ supabaseUrl: SUPABASE_URL, bucket: "b", path: "a.jpg", transform: { width: 96 * 2.75 } });
    expect(url).toContain("width=264");
  });

  it("strips a leading slash on the path rather than doubling it", () => {
    expect(publicStorageUrl({ supabaseUrl: SUPABASE_URL, bucket: "b", path: "/a.jpg" })).toBe(
      "https://abcdefgh.supabase.co/storage/v1/object/public/b/a.jpg"
    );
  });

  it("tolerates a trailing slash on the project URL", () => {
    expect(publicStorageUrl({ supabaseUrl: "https://abcdefgh.supabase.co/", bucket: "b", path: "a.jpg" })).toBe(
      "https://abcdefgh.supabase.co/storage/v1/object/public/b/a.jpg"
    );
  });
});

describe("the standard sizes", () => {
  it("asks for a thumbnail wide enough for a dense phone screen", () => {
    expect(THUMBNAIL.width).toBeGreaterThanOrEqual(96 * 3);
  });

  it("crops neither size, so markers stored as fractions still land correctly", () => {
    // A marker is a fraction of the image. Crop the image and the fraction
    // points somewhere else entirely, so neither standard size sets a height.
    expect(THUMBNAIL.height).toBeUndefined();
    expect(PREVIEW.height).toBeUndefined();
  });

  it("asks for less than the original in both cases", () => {
    expect(THUMBNAIL.quality).toBeLessThan(100);
    expect(PREVIEW.quality).toBeLessThan(100);
    expect(THUMBNAIL.width!).toBeLessThan(PREVIEW.width!);
  });
});
