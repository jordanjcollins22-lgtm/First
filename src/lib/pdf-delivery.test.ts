import { describe, expect, it } from "vitest";

import { canShareFile, deliveryFor, fileNameFrom, isStandalone } from "@/lib/pdf-delivery";

describe("whether the share sheet will take a file", () => {
  const file = { name: "kit.pdf" };

  it("takes it when the browser says it can", () => {
    expect(canShareFile({ share: async () => {}, canShare: () => true }, file)).toBe(true);
  });

  it("does not, when the browser says it cannot", () => {
    expect(canShareFile({ share: async () => {}, canShare: () => false }, file)).toBe(false);
  });

  it("does not, when the browser shares links but not files", () => {
    // Calling share with a file there throws rather than falling back, which
    // would leave somebody tapping a button that does nothing.
    expect(canShareFile({ share: async () => {} }, file)).toBe(false);
  });

  it("does not, when the browser has no share at all", () => {
    expect(canShareFile({}, file)).toBe(false);
    expect(canShareFile(undefined, file)).toBe(false);
  });

  it("survives a canShare that throws instead of answering", () => {
    const nav = {
      share: async () => {},
      canShare: () => {
        throw new Error("nope");
      },
    };
    expect(canShareFile(nav, file)).toBe(false);
  });
});

describe("how to hand the file over", () => {
  it("shares it whenever the device will", () => {
    expect(deliveryFor({ canShare: true, standalone: true, touch: true })).toBe("share");
    expect(deliveryFor({ canShare: true, standalone: false, touch: false })).toBe("share");
  });

  it("never just opens it in a window with no print button", () => {
    // The bug this exists for: a home-screen app shows the PDF and nothing
    // else — no toolbar, no share, no print.
    expect(deliveryFor({ canShare: false, standalone: true, touch: true })).toBe("download");
  });

  it("downloads on a phone that cannot share, rather than opening a dead end", () => {
    expect(deliveryFor({ canShare: false, standalone: false, touch: true })).toBe("download");
  });

  it("opens it in a tab on a desktop, where that is what people expect", () => {
    expect(deliveryFor({ canShare: false, standalone: false, touch: false })).toBe("open");
  });
});

describe("knowing there is no browser chrome", () => {
  it("believes iOS, which says so on navigator", () => {
    expect(isStandalone({ navigator: { standalone: true } })).toBe(true);
  });

  it("believes the media query, which is how everything else says so", () => {
    expect(isStandalone({ matchMedia: () => ({ matches: true }) })).toBe(true);
  });

  it("says no for an ordinary browser tab", () => {
    expect(isStandalone({ navigator: {}, matchMedia: () => ({ matches: false }) })).toBe(false);
  });

  it("says no rather than throwing when neither is there", () => {
    expect(isStandalone({})).toBe(false);
  });
});

describe("what the shared file is called", () => {
  it("takes the name the server already chose", () => {
    // The routes name these after the business and the kit. "document.pdf" in
    // somebody's Files is a sheet they will never find again.
    expect(fileNameFrom('inline; filename="js-kit-2-checklist.pdf"', "sheet.pdf")).toBe(
      "js-kit-2-checklist.pdf"
    );
  });

  it("copes without the quotes", () => {
    expect(fileNameFrom("attachment; filename=kit.pdf", "sheet.pdf")).toBe("kit.pdf");
  });

  it("prefers the encoded name, which is the one with the real characters in", () => {
    const header = "attachment; filename=\"j-s-kit.pdf\"; filename*=UTF-8''j%27s%20kit.pdf";
    expect(fileNameFrom(header, "sheet.pdf")).toBe("j's kit.pdf");
  });

  it("falls back when the header says nothing useful", () => {
    expect(fileNameFrom(null, "sheet.pdf")).toBe("sheet.pdf");
    expect(fileNameFrom("", "sheet.pdf")).toBe("sheet.pdf");
    expect(fileNameFrom("attachment", "sheet.pdf")).toBe("sheet.pdf");
  });

  it("falls back rather than throwing on a broken encoding", () => {
    expect(fileNameFrom("attachment; filename*=UTF-8''%E0%A4%A", "sheet.pdf")).toBe("sheet.pdf");
  });
});
