import { describe, expect, it } from "vitest";

import { caseFileKind, caseFileLabel, caseFilesFromObjects, formatFileSize, isCaseFilesToken } from "./case-files";

describe("case files", () => {
  it("names a file the way a person would", () => {
    expect(caseFileLabel("2-Bay-Walkthrough-Video-2026-08-20.mp4")).toBe("Bay Walkthrough Video 2026-08-20");
    expect(caseFileLabel("6-Complaint-1500.jpg")).toBe("Complaint 1500");
  });

  it("knows a video from a photo from a pdf", () => {
    expect(caseFileKind("a.MOV")).toBe("video");
    expect(caseFileKind("a.jpg")).toBe("image");
    expect(caseFileKind("a.pdf")).toBe("pdf");
    expect(caseFileKind("a.zip")).toBe("zip");
    expect(caseFileKind("a.txt")).toBe("other");
  });

  it("shows the playable copy of a video, not the original beside it, in numbered order", () => {
    const files = caseFilesFromObjects([
      { name: "10-Last.jpg" },
      { name: "2-Video.mov" },
      { name: "2-Video.mp4" },
      { name: "1-Evidence.pdf" },
      { name: ".emptyFolderPlaceholder" },
      { name: "index.html" },
    ]);
    expect(files.map((f) => f.name)).toEqual(["1-Evidence.pdf", "2-Video.mp4", "10-Last.jpg"]);
  });

  it("keeps a .mov that has no playable copy", () => {
    expect(caseFilesFromObjects([{ name: "clip.mov" }]).map((f) => f.name)).toEqual(["clip.mov"]);
  });

  it("formats sizes", () => {
    expect(formatFileSize(16466193)).toBe("15.7 MB");
    expect(formatFileSize(651686)).toBe("636 KB");
    expect(formatFileSize(null)).toBe("");
  });

  it("only accepts tokens shaped like the ones we make", () => {
    expect(isCaseFilesToken("m5bcsfEwp2ZaMUP0LfEt8B75")).toBe(true);
    expect(isCaseFilesToken("../secret")).toBe(false);
    expect(isCaseFilesToken("short")).toBe(false);
  });
});
