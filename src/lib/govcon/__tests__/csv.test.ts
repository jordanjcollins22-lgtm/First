import { describe, expect, it } from "vitest";

import { CsvStreamParser, parseCsv } from "../csv";

describe("CsvStreamParser", () => {
  it("parses quoted fields with commas, escaped quotes and newlines", () => {
    const rows = parseCsv('"a","b, c","say ""hi""","line1\nline2"\n"x","","y","z"\n');
    expect(rows).toEqual([
      ["a", "b, c", 'say "hi"', "line1\nline2"],
      ["x", "", "y", "z"],
    ]);
  });

  it("handles rows split across arbitrary chunk boundaries", () => {
    const text = '"id","desc"\r\n"1","has ""quotes"" and\r\nbreaks"\r\n"2","plain"';
    const whole = parseCsv(text);
    for (let size = 1; size < text.length; size++) {
      const p = new CsvStreamParser();
      const rows: string[][] = [];
      for (let i = 0; i < text.length; i += size) rows.push(...p.push(text.slice(i, i + size)));
      rows.push(...p.end());
      expect(rows).toEqual(whole);
    }
    expect(whole[1]).toEqual(["1", 'has "quotes" and\nbreaks']);
  });
});
