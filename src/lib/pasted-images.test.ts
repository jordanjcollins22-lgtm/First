import { describe, expect, it } from "vitest";

import {
  extensionForImage,
  imagesFromClipboard,
  isImageType,
  pasteIsForTyping,
} from "@/lib/pasted-images";

/** A stand-in for a File, which vitest's environment does not always give us. */
function file(type: string, size: number, name = ""): File {
  return { type, size, name } as unknown as File;
}

function item(type: string, made: File | null, kind = "file") {
  return { kind, type, getAsFile: () => made };
}

describe("naming a pasted image", () => {
  it("stores a jpeg as jpg, which is what everything else calls it", () => {
    expect(extensionForImage("image/jpeg")).toBe("jpg");
  });

  it("takes the extension from the type", () => {
    expect(extensionForImage("image/png")).toBe("png");
    expect(extensionForImage("image/webp")).toBe("webp");
    expect(extensionForImage("image/gif")).toBe("gif");
  });

  it("handles a type with a suffix on it", () => {
    expect(extensionForImage("image/svg+xml")).toBe("svg");
  });

  it("falls back to the file's own name when the type says nothing", () => {
    expect(extensionForImage("", "porch.HEIC")).toBe("heic");
  });

  it("guesses png for a screenshot with neither", () => {
    // The browser reads the bytes and not the name, so a guess that is usually
    // right beats refusing the paste.
    expect(extensionForImage("")).toBe("png");
    expect(extensionForImage("image/")).toBe("png");
  });

  it("does not take a whole filename as an extension", () => {
    expect(extensionForImage("", "no-dot-here")).toBe("png");
  });
});

describe("telling a picture from what came with it", () => {
  it("says yes to an image", () => {
    expect(isImageType("image/png")).toBe(true);
    expect(isImageType("IMAGE/JPEG")).toBe(true);
  });

  it("says no to the text and the markup that came with it", () => {
    expect(isImageType("text/html")).toBe(false);
    expect(isImageType("text/plain")).toBe(false);
    expect(isImageType("")).toBe(false);
  });
});

describe("picking the images off a clipboard", () => {
  it("takes the picture and leaves the markup", () => {
    // Copying an image from a web page puts the picture and the HTML that
    // held it on the clipboard together.
    const picture = file("image/png", 1024);
    const found = imagesFromClipboard({
      items: [item("text/html", null), item("image/png", picture)],
    });
    expect(found).toEqual([picture]);
  });

  it("reads the files list, which is where Safari puts them", () => {
    const picture = file("image/jpeg", 2048);
    expect(imagesFromClipboard({ files: [picture] })).toEqual([picture]);
  });

  it("does not add the same picture twice when both lists hold it", () => {
    const picture = file("image/png", 1024);
    const found = imagesFromClipboard({
      items: [item("image/png", picture)],
      files: [file("image/png", 1024)],
    });
    expect(found).toHaveLength(1);
  });

  it("keeps two different pictures pasted together", () => {
    const found = imagesFromClipboard({
      files: [file("image/png", 1024), file("image/png", 4096)],
    });
    expect(found).toHaveLength(2);
  });

  it("ignores an item that says it is a file and hands back nothing", () => {
    expect(imagesFromClipboard({ items: [item("image/png", null)] })).toEqual([]);
  });

  it("ignores a string item, whatever it claims to be", () => {
    const picture = file("image/png", 1024);
    expect(imagesFromClipboard({ items: [item("image/png", picture, "string")] })).toEqual([]);
  });

  it("gives back nothing for a clipboard with no picture on it", () => {
    expect(imagesFromClipboard({ items: [item("text/plain", null)] })).toEqual([]);
    expect(imagesFromClipboard({})).toEqual([]);
    expect(imagesFromClipboard(null)).toEqual([]);
  });
});

describe("whose paste it is", () => {
  it("leaves a paste into a text box alone", () => {
    // Somebody pasting an address into the notes box is pasting into the
    // notes box.
    expect(pasteIsForTyping({ tagName: "TEXTAREA" } as unknown as EventTarget)).toBe(true);
    expect(pasteIsForTyping({ tagName: "input" } as unknown as EventTarget)).toBe(true);
    expect(pasteIsForTyping({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget)).toBe(true);
  });

  it("takes a paste with nowhere else to go", () => {
    expect(pasteIsForTyping({ tagName: "DIV" } as unknown as EventTarget)).toBe(false);
    expect(pasteIsForTyping({ tagName: "BUTTON" } as unknown as EventTarget)).toBe(false);
  });

  it("takes a paste with no target at all", () => {
    expect(pasteIsForTyping(null)).toBe(false);
  });
});
