import { describe, expect, it } from "vitest";
import { MAX_FUNDAMENTALS, notesPrompt, parseNotes, pickTrack, textFromJson3, textFromXml, youtubeId } from "./video-notes";

describe("youtubeId", () => {
  it("reads every kind of YouTube link", () => {
    expect(youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("youtu.be/dQw4w9WgXcQ?si=abc")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://m.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://www.youtube.com/live/dQw4w9WgXcQ?feature=share")).toBe("dQw4w9WgXcQ");
    expect(youtubeId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("refuses anything that isn't a YouTube video", () => {
    expect(youtubeId("https://vimeo.com/123")).toBeNull();
    expect(youtubeId("https://evil.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(youtubeId("not a link")).toBeNull();
  });
});

describe("captions", () => {
  it("prefers English written by a person", () => {
    const tracks = [
      { baseUrl: "a", languageCode: "es" },
      { baseUrl: "b", languageCode: "en", kind: "asr" },
      { baseUrl: "c", languageCode: "en-US" },
    ];
    expect(pickTrack(tracks)?.baseUrl).toBe("c");
    expect(pickTrack(tracks.slice(0, 2))?.baseUrl).toBe("b");
    expect(pickTrack([])).toBeNull();
  });

  it("reads json3 and XML caption files", () => {
    expect(textFromJson3({ events: [{ segs: [{ utf8: "Edge " }, { utf8: "the beds" }] }, {}, { segs: [{ utf8: "\nfirst." }] }] })).toBe("Edge the beds first.");
    expect(textFromXml('<transcript><text start="0">Mulch &amp;amp; edge</text><text start="2">it&#39;s done</text></transcript>')).toBe("Mulch & edge it's done");
  });
});

describe("notes", () => {
  it("asks with what you know and want", () => {
    const p = notesPrompt({ title: "Edging 101", know: "I mow", want: ["Mistakes to avoid"], transcript: "words" });
    expect(p).toContain("What I already know: I mow");
    expect(p).toContain("Mistakes to avoid");
    expect(p.endsWith("words")).toBe(true);
  });

  it("checks and trims the answer", () => {
    const raw = `Here you go: ${JSON.stringify({
      gist: "How to edge beds",
      fundamentals: Array.from({ length: 10 }, (_, i) => ({ point: `P${i}`, detail: "d" })),
      answers: [{ question: "Q", answer: "A" }, { question: "", answer: "x" }],
      learned: "L",
      use: ["Do it", 3],
      watchIt: "Minutes 2-5",
    })}`;
    const n = parseNotes(raw)!;
    expect(n.fundamentals).toHaveLength(MAX_FUNDAMENTALS);
    expect(n.answers).toEqual([{ question: "Q", answer: "A" }]);
    expect(n.use).toEqual(["Do it"]);
  });

  it("refuses an answer with no fundamentals", () => {
    expect(parseNotes("{}")).toBeNull();
    expect(parseNotes("no json")).toBeNull();
  });
});
