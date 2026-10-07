/**
 * Streaming RFC-4180 CSV parser. SAM.gov's daily opportunities file is
 * ~200 MB with multi-line quoted descriptions, so we can't split on lines
 * or buffer the whole thing in a serverless function. Feed decoded text
 * chunks in; complete rows come out.
 */
export class CsvStreamParser {
  private field = "";
  private row: string[] = [];
  private inQuotes = false;
  /** A quote seen inside a quoted field: either an escaped "" or the closing quote. */
  private pendingQuote = false;

  /** Parse a chunk; returns every row completed within it. */
  push(chunk: string): string[][] {
    const rows: string[][] = [];
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (this.pendingQuote) {
        this.pendingQuote = false;
        if (c === '"') {
          this.field += '"';
          continue;
        }
        this.inQuotes = false; // that quote closed the field; fall through
      }
      if (this.inQuotes) {
        if (c === '"') this.pendingQuote = true;
        else if (c !== "\r") this.field += c; // normalize CRLF inside fields
        continue;
      }
      if (c === '"') {
        this.inQuotes = true;
      } else if (c === ",") {
        this.row.push(this.field);
        this.field = "";
      } else if (c === "\n") {
        this.row.push(this.field);
        rows.push(this.row);
        this.row = [];
        this.field = "";
      } else if (c !== "\r") {
        this.field += c;
      }
    }
    return rows;
  }

  /** Flush the final row if the input didn't end with a newline. */
  end(): string[][] {
    if (this.pendingQuote) {
      this.pendingQuote = false;
      this.inQuotes = false;
    }
    if (this.field !== "" || this.row.length) {
      this.row.push(this.field);
      const last = this.row;
      this.row = [];
      this.field = "";
      return [last];
    }
    return [];
  }
}

/** Convenience for tests and small files. */
export function parseCsv(text: string): string[][] {
  const p = new CsvStreamParser();
  return [...p.push(text), ...p.end()];
}
