import { describe, expect, it } from "vitest";

import {
  extensionForImage,
  fileFromDataUrl,
  imageUrlFromHtml,
  imagesFromClipboard,
  isDataImageUrl,
  isFetchableImageUrl,
  isImageType,
  pasteIsForTyping,
  pickImageType,
  readClipboardImages,
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

describe("choosing which form of a copied picture to ask for", () => {
  it("prefers png, which is lossless and read by everything", () => {
    expect(pickImageType(["image/jpeg", "image/png"])).toBe("image/png");
  });

  it("takes whatever picture is on offer when there is no png", () => {
    expect(pickImageType(["text/html", "image/webp"])).toBe("image/webp");
  });

  it("ignores the text and markup that came with it", () => {
    expect(pickImageType(["text/html", "text/plain"])).toBeNull();
    expect(pickImageType([])).toBeNull();
  });
});

describe("reading pictures off the system clipboard", () => {
  const entry = (types: string[], blob: Blob | Error = new Blob(["x"])) => ({
    types,
    getType: async () => {
      if (blob instanceof Error) throw blob;
      return blob;
    },
  });

  it("makes a named file out of what it read", async () => {
    const [image] = await readClipboardImages([entry(["image/png"])]);
    expect(image.type).toBe("image/png");
    expect(image.name).toBe("pasted.png");
  });

  it("skips an entry with no picture in it", async () => {
    expect(await readClipboardImages([entry(["text/plain"])])).toEqual([]);
  });

  it("keeps the others when one entry will not open", async () => {
    // A clipboard entry that refuses to be read is not a reason to lose the
    // picture beside it.
    const images = await readClipboardImages([
      entry(["image/png"], new Error("denied")),
      entry(["image/jpeg"]),
    ]);
    expect(images).toHaveLength(1);
    expect(images[0].type).toBe("image/jpeg");
  });

  it("gives back nothing for an empty clipboard", async () => {
    expect(await readClipboardImages([])).toEqual([]);
  });
});

describe("finding the picture behind copied document content", () => {
  it("finds the address in what Google Docs puts on the clipboard", () => {
    // Copying an image out of a document puts the HTML that held it on the
    // clipboard, with the picture left where it was.
    const html = `<meta charset='utf-8'><img src="https://lh7-rt.googleusercontent.com/docsz/abc?w=600&amp;h=400">`;
    expect(imageUrlFromHtml(html)).toBe("https://lh7-rt.googleusercontent.com/docsz/abc?w=600&h=400");
  });

  it("reads single quotes and bare addresses too", () => {
    expect(imageUrlFromHtml("<img src='https://example.com/a.png'>")).toBe("https://example.com/a.png");
    expect(imageUrlFromHtml("<img src=https://example.com/a.png >")).toBe("https://example.com/a.png");
  });

  it("takes the first picture when the copy held several", () => {
    const html = '<img src="https://example.com/one.png"><img src="https://example.com/two.png">';
    expect(imageUrlFromHtml(html)).toBe("https://example.com/one.png");
  });

  it("finds nothing in markup with no picture in it", () => {
    expect(imageUrlFromHtml("<p>Just some words.</p>")).toBeNull();
    expect(imageUrlFromHtml("")).toBeNull();
  });
});

describe("a picture spelled out in the address itself", () => {
  const PIXEL =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  it("recognises one", () => {
    expect(isDataImageUrl(PIXEL)).toBe(true);
    expect(isDataImageUrl("https://example.com/a.png")).toBe(false);
    expect(isDataImageUrl("data:text/plain;base64,aGk=")).toBe(false);
  });

  it("reads it out as a file", () => {
    const image = fileFromDataUrl(PIXEL);
    expect(image?.type).toBe("image/png");
    expect(image?.name).toBe("pasted.png");
    expect(image?.size).toBeGreaterThan(0);
  });

  it("gives back nothing for one it cannot read", () => {
    expect(fileFromDataUrl("data:image/png;base64,!!!!not base64!!!!")).toBeNull();
    expect(fileFromDataUrl("data:image/png;base64,")).toBeNull();
    expect(fileFromDataUrl("https://example.com/a.png")).toBeNull();
  });
});

describe("whether an address is one we will go and fetch", () => {
  it("takes a public https address", () => {
    expect(isFetchableImageUrl("https://lh7-rt.googleusercontent.com/docsz/abc")).toBe(true);
  });

  it("refuses anything that is not https", () => {
    // A clipboard is not a trusted source of addresses and the fetch happens
    // on our server, with our network.
    expect(isFetchableImageUrl("http://example.com/a.png")).toBe(false);
    expect(isFetchableImageUrl("file:///etc/passwd")).toBe(false);
  });

  it("refuses anything pointing back inside", () => {
    expect(isFetchableImageUrl("https://localhost/a.png")).toBe(false);
    expect(isFetchableImageUrl("https://intranet/a.png")).toBe(false);
    expect(isFetchableImageUrl("https://printer.local/a.png")).toBe(false);
    expect(isFetchableImageUrl("https://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isFetchableImageUrl("https://10.0.0.5/a.png")).toBe(false);
    expect(isFetchableImageUrl("https://[::1]/a.png")).toBe(false);
  });

  it("refuses something that is not an address at all", () => {
    expect(isFetchableImageUrl("not a url")).toBe(false);
    expect(isFetchableImageUrl("")).toBe(false);
  });
});
