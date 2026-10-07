import { unzipSync, strFromU8 } from "fflate";

/**
 * Minimal .xlsx → text (tab-separated rows per sheet) so pricing schedules
 * and frequency charts can go to Claude. Handles shared strings, inline
 * strings and numbers; ignores formatting and formulas (cached values win).
 */
function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

function colIndex(ref: string): number {
  const letters = ref.replace(/\d+/g, "");
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function xlsxToText(bytes: Uint8Array, maxChars = 200_000): string {
  const files = unzipSync(bytes, { filter: (f) => f.name.startsWith("xl/") });
  const shared: string[] = [];
  const sst = files["xl/sharedStrings.xml"];
  if (sst) {
    for (const si of strFromU8(sst).match(/<si>[\s\S]*?<\/si>/g) ?? []) {
      shared.push(decodeXml((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join("")));
    }
  }
  // Sheet names in workbook order.
  const names = [...strFromU8(files["xl/workbook.xml"] ?? new Uint8Array()).matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => decodeXml(m[1]));
  const sheetFiles = Object.keys(files)
    .filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));

  const out: string[] = [];
  sheetFiles.forEach((file, i) => {
    out.push(`## Sheet: ${names[i] ?? file}`);
    const xml = strFromU8(files[file]);
    for (const row of xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) ?? []) {
      const cells: string[] = [];
      for (const c of row.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
        const ref = c.match(/r="([A-Z]+\d+)"/)?.[1];
        const type = c.match(/ t="([^"]+)"/)?.[1];
        const v = c.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let value = "";
        if (type === "s" && v !== undefined) value = shared[Number(v)] ?? "";
        else if (type === "inlineStr") value = decodeXml((c.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? "").replace(/<[^>]+>/g, ""));
        else if (v !== undefined) value = decodeXml(v);
        const idx = ref ? colIndex(ref) : cells.length;
        while (cells.length < idx) cells.push("");
        cells[idx] = value.replace(/\s+/g, " ").trim();
      }
      if (cells.some((x) => x)) out.push(cells.join("\t").replace(/\t+$/, ""));
    }
  });
  const text = out.join("\n");
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[truncated]` : text;
}
