/**
 * Bank/credit-card statement CSV parsing.
 *
 * Banks don't agree on a format, so this finds the date, description and
 * amount columns by header name. It handles a single signed "Amount" column
 * or separate Debit/Credit (Withdrawal/Deposit) columns, quoted fields,
 * "$1,234.56" and "(12.00)" amounts, and MM/DD/YYYY or YYYY-MM-DD dates.
 *
 * Output amounts are always: positive = money in, negative = money out.
 */

export interface ParsedRow {
  postedOn: string; // YYYY-MM-DD
  description: string;
  amount: number;
}

export interface ParseResult {
  rows: ParsedRow[];
  skipped: { line: number; reason: string }[];
  columns: { date: string; description: string; amount: string };
}

export interface ParseOptions {
  /**
   * Some card exports (e.g. American Express) list purchases as positive
   * numbers. Set this to flip them so purchases come out negative.
   */
  purchasesArePositive?: boolean;
}

/** RFC 4180-ish: quotes, escaped quotes, commas and newlines inside quotes. */
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

const DATE_HEADERS = ["posted date", "posting date", "post date", "transaction date", "trans date", "date"];
const DESC_HEADERS = ["description", "payee", "merchant", "name", "details", "memo", "transaction description"];
const AMOUNT_HEADERS = ["amount", "transaction amount", "amount (usd)"];
const DEBIT_HEADERS = ["debit", "debits", "withdrawal", "withdrawals", "withdrawal amount", "debit amount", "money out", "charges"];
const CREDIT_HEADERS = ["credit", "credits", "deposit", "deposits", "deposit amount", "credit amount", "money in", "payments"];

function findColumn(headers: string[], candidates: string[]): number {
  for (const candidate of candidates) {
    const idx = headers.indexOf(candidate);
    if (idx !== -1) return idx;
  }
  return -1;
}

export function parseAmount(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/\s*(cr)$/i.test(s)) s = s.replace(/\s*cr$/i, "");
  if (/\s*(dr)$/i.test(s)) {
    negative = !negative;
    s = s.replace(/\s*dr$/i, "");
  }
  s = s.replace(/[$,\s]/g, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const value = Number(s);
  if (!Number.isFinite(value)) return null;
  return Math.round((negative ? -value : value) * 100) / 100;
}

export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return toIso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    let year = Number(m[3]);
    if (m[3].length === 2) year += 2000;
    return toIso(year, Number(m[1]), Number(m[2]));
  }
  return null;
}

function toIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null;
  return date.toISOString().slice(0, 10);
}

export function parseStatementCsv(text: string, options: ParseOptions = {}): ParseResult {
  const table = parseCsvText(text);

  // Some banks put account info above the real header row. Use the first
  // row that has a date column and either an amount or debit/credit column.
  let headerIdx = -1;
  let headers: string[] = [];
  for (let i = 0; i < Math.min(table.length, 15); i++) {
    const candidate = table[i].map((h) => h.trim().toLowerCase());
    const hasDate = findColumn(candidate, DATE_HEADERS) !== -1;
    const hasAmount =
      findColumn(candidate, AMOUNT_HEADERS) !== -1 ||
      findColumn(candidate, DEBIT_HEADERS) !== -1 ||
      findColumn(candidate, CREDIT_HEADERS) !== -1;
    if (hasDate && hasAmount) {
      headerIdx = i;
      headers = candidate;
      break;
    }
  }
  if (headerIdx === -1) {
    throw new Error(
      "Couldn't find the header row. The CSV needs a Date column and either an Amount column or Debit/Credit columns."
    );
  }

  const dateCol = findColumn(headers, DATE_HEADERS);
  const descCol = findColumn(headers, DESC_HEADERS);
  const amountCol = findColumn(headers, AMOUNT_HEADERS);
  const debitCol = findColumn(headers, DEBIT_HEADERS);
  const creditCol = findColumn(headers, CREDIT_HEADERS);
  if (descCol === -1) throw new Error("Couldn't find a Description (or Payee/Name/Memo) column.");

  const rows: ParsedRow[] = [];
  const skipped: ParseResult["skipped"] = [];

  for (let i = headerIdx + 1; i < table.length; i++) {
    const cells = table[i];
    const line = i + 1;
    const postedOn = parseDate(cells[dateCol] ?? "");
    if (!postedOn) {
      skipped.push({ line, reason: `Unreadable date "${cells[dateCol] ?? ""}"` });
      continue;
    }
    const description = (cells[descCol] ?? "").trim();

    let amount: number | null;
    if (amountCol !== -1) {
      amount = parseAmount(cells[amountCol] ?? "");
      if (amount !== null && options.purchasesArePositive) amount = -amount;
    } else {
      // Debit/credit columns: both are listed as positive numbers.
      const debit = debitCol !== -1 ? parseAmount(cells[debitCol] ?? "") : null;
      const credit = creditCol !== -1 ? parseAmount(cells[creditCol] ?? "") : null;
      if (debit === null && credit === null) amount = null;
      else amount = Math.round(((credit ? Math.abs(credit) : 0) - (debit ? Math.abs(debit) : 0)) * 100) / 100;
    }

    if (amount === null) {
      skipped.push({ line, reason: "No amount" });
      continue;
    }
    if (amount === 0) {
      skipped.push({ line, reason: "Zero amount" });
      continue;
    }
    rows.push({ postedOn, description: description || "(no description)", amount });
  }

  return {
    rows,
    skipped,
    columns: {
      date: headers[dateCol],
      description: headers[descCol],
      amount: amountCol !== -1 ? headers[amountCol] : [headers[debitCol], headers[creditCol]].filter(Boolean).join(" / "),
    },
  };
}

/**
 * Stable id for a CSV row so re-uploading the same or an overlapping
 * statement doesn't double-count. Two identical charges on the same day are
 * told apart by their occurrence number within the upload.
 */
export function csvExternalIds(accountId: string, rows: ParsedRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const base = `${accountId}|${row.postedOn}|${row.amount.toFixed(2)}|${row.description.toLowerCase().replace(/\s+/g, " ").trim()}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `csv:${base}|${n}`;
  });
}
