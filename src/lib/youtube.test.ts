import { describe, expect, it } from "vitest";

import { parseYouTubeId, youTubeEmbedUrl } from "./youtube";

const ID = "dQw4w9WgXcQ";

describe("parseYouTubeId", () => {
  it.each([
    ID,
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?feature=share&v=${ID}&t=42`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}?si=abc`,
    `youtu.be/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `  https://www.youtube.com/watch?v=${ID}  `,
  ])("extracts the ID from %s", (input) => {
    expect(parseYouTubeId(input)).toBe(ID);
  });

  it.each(["", "hello world", "https://vimeo.com/123456", "https://www.youtube.com/watch?v=short", "https://evil.com/watch?v=" + ID])(
    "rejects %s",
    (input) => {
      expect(parseYouTubeId(input)).toBeNull();
    }
  );
});

describe("youTubeEmbedUrl", () => {
  it("uses the privacy-enhanced domain", () => {
    expect(youTubeEmbedUrl(ID)).toMatch(`https://www.youtube-nocookie.com/embed/${ID}?`);
    expect(youTubeEmbedUrl(ID, true)).toContain("autoplay=1");
  });
});
