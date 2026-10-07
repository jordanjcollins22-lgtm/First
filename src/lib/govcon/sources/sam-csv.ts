import { CsvStreamParser } from "../csv";
import {
  blankToNull,
  htmlToText,
  normalizeDate,
  normalizeNoticeType,
  normalizeSetAside,
  parseMoney,
} from "../normalize";
import type { Opportunity, PointOfContact } from "../types";

/**
 * SAM.gov "Contract Opportunities" public daily extract — every active
 * notice in one CSV, no API key needed. Rebuilt ~03:30 UTC daily.
 * Encoding is Windows-1252 (not UTF-8); descriptions are inline multi-line.
 */
export const SAM_CSV_URL =
  "https://falextracts.s3.amazonaws.com/Contract%20Opportunities/datagov/ContractOpportunitiesFullCSV.csv";

export interface AwardNoticeRow {
  noticeId: string;
  solicitationNumber: string | null;
  awardNumber: string | null;
  awardDate: string | null;
  amount: number | null;
  awardee: string | null;
  naicsCode: string | null;
  title: string;
}

export function rowToOpportunity(r: Record<string, string>): Opportunity {
  const contacts: PointOfContact[] = [];
  if (r.PrimaryContactFullname || r.PrimaryContactEmail) {
    contacts.push({
      type: "primary",
      name: blankToNull(r.PrimaryContactFullname),
      email: blankToNull(r.PrimaryContactEmail),
      phone: blankToNull(r.PrimaryContactPhone),
    });
  }
  if (r.SecondaryContactFullname || r.SecondaryContactEmail) {
    contacts.push({
      type: "secondary",
      name: blankToNull(r.SecondaryContactFullname),
      email: blankToNull(r.SecondaryContactEmail),
      phone: blankToNull(r.SecondaryContactPhone),
    });
  }
  const noticeId = r.NoticeId.trim();
  return {
    externalId: noticeId,
    source: "sam_csv",
    noticeType: normalizeNoticeType(r.Type),
    title: r.Title?.trim() ?? "",
    solicitationNumber: blankToNull(r["Sol#"]),
    agency: blankToNull(r["Department/Ind.Agency"]),
    office: blankToNull(r.Office) ?? blankToNull(r["Sub-Tier"]),
    naicsCode: blankToNull(r.NaicsCode),
    pscCode: blankToNull(r.ClassificationCode),
    setAside: normalizeSetAside(r.SetASideCode),
    setAsideLabel: blankToNull(r.SetASide),
    postedDate: normalizeDate(r.PostedDate),
    responseDeadline: normalizeDate(r.ResponseDeadLine),
    placeOfPerformance: {
      city: blankToNull(r.PopCity),
      // Foreign subdivisions come through as "DE-RP"; only keep US states.
      state: /^[A-Z]{2}$/.test(r.PopState ?? "") ? r.PopState : null,
      zip: blankToNull(r.PopZip)?.slice(0, 5) ?? null,
      // Overseas notices often leave PopCountry blank; the office country is a good proxy.
      country: blankToNull(r.PopCountry) ?? (r.PopState ? null : blankToNull(r.CountryCode)),
    },
    pointsOfContact: contacts,
    description: htmlToText(r.Description),
    url: `https://sam.gov/opp/${noticeId}/view`,
    attachmentUrls: [],
    estimatedValue: parseMoney(r["Award$"]),
    active: (r.Active ?? "Yes").toLowerCase() === "yes",
  };
}

export interface StreamSamCsvOptions {
  /** Skip the download when the file hasn't changed since this ETag. */
  ifNoneMatch?: string | null;
  onOpportunity: (opp: Opportunity) => void | Promise<void>;
  onAward?: (award: AwardNoticeRow) => void | Promise<void>;
  url?: string;
  /** Read a local file instead (scripts / tests). */
  body?: ReadableStream<Uint8Array>;
}

export interface StreamSamCsvResult {
  notModified: boolean;
  etag: string | null;
  rows: number;
}

export async function streamSamCsv(opts: StreamSamCsvOptions): Promise<StreamSamCsvResult> {
  let body = opts.body;
  let etag: string | null = null;
  if (!body) {
    const res = await fetch(opts.url ?? SAM_CSV_URL, {
      headers: opts.ifNoneMatch ? { "If-None-Match": opts.ifNoneMatch } : {},
      cache: "no-store",
    });
    etag = res.headers.get("etag");
    if (res.status === 304) return { notModified: true, etag: opts.ifNoneMatch ?? etag, rows: 0 };
    if (!res.ok || !res.body) throw new Error(`SAM CSV download failed: HTTP ${res.status}`);
    body = res.body;
  }

  const decoder = new TextDecoder("windows-1252");
  const parser = new CsvStreamParser();
  let header: string[] | null = null;
  let rows = 0;

  const handle = async (cells: string[]) => {
    if (!header) {
      header = cells;
      return;
    }
    if (cells.length < header.length - 1) return; // malformed/blank line
    const record: Record<string, string> = {};
    header.forEach((h, i) => (record[h] = cells[i] ?? ""));
    rows++;
    if (!record.NoticeId) return;
    if (record.Type === "Award Notice" && opts.onAward) {
      await opts.onAward({
        noticeId: record.NoticeId,
        solicitationNumber: blankToNull(record["Sol#"]),
        awardNumber: blankToNull(record.AwardNumber),
        awardDate: blankToNull(record.AwardDate),
        amount: parseMoney(record["Award$"]),
        awardee: blankToNull(record.Awardee),
        naicsCode: blankToNull(record.NaicsCode),
        title: record.Title ?? "",
      });
      return;
    }
    await opts.onOpportunity(rowToOpportunity(record));
  };

  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const cells of parser.push(decoder.decode(value, { stream: true }))) await handle(cells);
  }
  for (const cells of parser.push(decoder.decode())) await handle(cells);
  for (const cells of parser.end()) await handle(cells);

  return { notModified: false, etag, rows };
}
