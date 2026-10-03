import { describe, expect, it } from "vitest";

import { textToHtml } from "./plain";

describe("textToHtml", () => {
  it("keeps paragraphs, escapes markup and links the links", () => {
    const html = textToHtml("Hi Deanna,\n\nSee <you> Thursday.\n\nhttps://app.jslandscapingmd.com/prep/abc");
    expect(html).toContain("<p style=\"margin:0 0 1em\">Hi Deanna,</p>");
    expect(html).toContain("See &lt;you&gt; Thursday.");
    expect(html).toContain('<a href="https://app.jslandscapingmd.com/prep/abc">https://app.jslandscapingmd.com/prep/abc</a>');
  });

  it("turns single line breaks into line breaks, not paragraphs", () => {
    expect(textToHtml("Jordan\nJS Landscaping")).toContain("Jordan<br>JS Landscaping");
  });
});
