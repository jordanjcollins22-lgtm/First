import { describe, expect, it } from "vitest";

import {
  caseFileKind,
  caseFileLabel,
  caseFilesFromObjects,
  formatFileSize,
  isCaseFilesToken,
  parseCaseLayout,
  pickLayoutFile,
} from "./case-files";

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

describe("case file layout", () => {
  const objects = [
    { name: "case.pdf", size: 100 },
    { name: "p01.jpg" },
    { name: "p02.jpg" },
    { name: "clip.mp4" },
    { name: "old-extra.jpg" },
  ];

  it("shows only the named files, section by section, in the given order", () => {
    const layout = parseCaseLayout(
      {
        title: "Case",
        download: { file: "case.pdf", label: "Download the case file" },
        sections: [
          { title: "Pages", files: ["p02.jpg", "p01.jpg"] },
          { title: "Video", note: "Ours", files: ["clip.mp4"] },
        ],
      },
      objects
    );
    expect(layout?.download?.file.name).toBe("case.pdf");
    expect(layout?.download?.label).toBe("Download the case file");
    expect(layout?.sections.map((s) => [s.title, s.files.map((f) => f.name)])).toEqual([
      ["Pages", ["p02.jpg", "p01.jpg"]],
      ["Video", ["clip.mp4"]],
    ]);
    expect(layout?.sections[1].files[0].kind).toBe("video");
    expect(layout?.sections[0].columns).toBe(1);
  });

  it("skips files that are not in the folder and sections left empty", () => {
    const layout = parseCaseLayout({ sections: [{ title: "Gone", files: ["missing.jpg"] }, { title: "Here", files: ["p01.jpg", "nope.jpg"] }] }, objects);
    expect(layout?.sections.map((s) => s.title)).toEqual(["Here"]);
    expect(layout?.sections[0].files.map((f) => f.name)).toEqual(["p01.jpg"]);
    expect(layout?.download).toBeUndefined();
  });

  it("is no layout at all when nothing in it matches", () => {
    expect(parseCaseLayout({ sections: [{ title: "x", files: ["missing"] }] }, objects)).toBeNull();
    expect(parseCaseLayout("nonsense", objects)).toBeNull();
    expect(parseCaseLayout(null, objects)).toBeNull();
  });
});

describe("picking the layout file", () => {
  it("uses the newest numbered layout", () => {
    expect(pickLayoutFile(["a.jpg", "layout.json", "layout-2.json", "layout-10.json", "layout-3.json"])).toBe("layout-10.json");
    expect(pickLayoutFile(["layout.json"])).toBe("layout.json");
    expect(pickLayoutFile(["meta.json"])).toBeNull();
  });

  it("reads a two-column section", () => {
    const layout = parseCaseLayout({ sections: [{ title: "Pages", columns: 2, files: ["p.jpg"] }] }, [{ name: "p.jpg" }]);
    expect(layout?.sections[0].columns).toBe(2);
  });
});
