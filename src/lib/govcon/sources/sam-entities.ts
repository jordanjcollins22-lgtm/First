import { Unzip, UnzipInflate, UnzipPassThrough } from "fflate";

import { TRADES } from "../trades";

/**
 * SAM.gov public entity extract (monthly, keyless): every registered
 * business with its address, website and NAICS codes, each flagged Y/N for
 * "small under that code's size standard". That's exactly what we need to
 * find local subs that count as *similarly situated* (small, registered),
 * and to verify a sub's size claim instead of trusting self-certification.
 *
 * Format (verified 2026-10): ZIP containing a ZIP containing one ~570 MB
 * pipe-delimited .dat, 142 fields, no header, first line "BOF PUBLIC V2 ...".
 * POC emails/phones are FOUO and not in the public file.
 */
export const SAM_ENTITY_LIST_URL =
  "https://sam.gov/api/prod/fileextractservices/v1/api/listfiles?domain=Entity%20Registration/Public%20V2";
export const samEntityDownloadUrl = (fileName: string) =>
  `https://sam.gov/api/prod/fileextractservices/v1/api/download/Entity%20Registration/Public%20V2/${encodeURIComponent(fileName)}?privacy=Public`;

/** Field positions (0-based) in the public V2 extract. */
const F = {
  uei: 0,
  cage: 3,
  status: 5,
  expires: 8,
  legalName: 11,
  dba: 12,
  address: 15,
  city: 17,
  state: 18,
  zip5: 19,
  country: 21,
  url: 26,
  businessTypes: 31,
  naicsList: 34,
  pocFirst: 46,
  pocLast: 48,
} as const;

/** NAICS we care about: every trade's codes plus all specialty trades / building services. */
const TARGET_NAICS = new Set(TRADES.flatMap((t) => t.naicsCodes));
export const isTargetNaics = (code: string) => TARGET_NAICS.has(code) || code.startsWith("238") || code.startsWith("5617");

export interface SamEntity {
  uei: string;
  cage: string | null;
  legal_name: string;
  dba_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip5: string | null;
  website: string | null;
  naics: string[];
  small_naics: string[];
  business_types: string[];
  poc_name: string | null;
  registration_expires: string | null;
}

const blank = (s: string | undefined) => {
  const v = s?.trim();
  return v ? v : null;
};

function yyyymmdd(s: string | undefined): string | null {
  const v = s?.trim();
  return v && /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : null;
}

/** Parse one record; returns null unless it's an active US entity in our NAICS. */
export function parseEntityLine(line: string): SamEntity | null {
  if (line.startsWith("BOF") || line.startsWith("EOF")) return null;
  const f = line.split("|");
  if (f.length < 60 || f[F.status] !== "A") return null;
  if ((f[F.country] ?? "").trim() !== "USA") return null;
  const naics: string[] = [];
  const small: string[] = [];
  for (const raw of (f[F.naicsList] ?? "").split("~")) {
    const code = raw.slice(0, 6);
    if (!/^\d{6}$/.test(code)) continue;
    naics.push(code);
    if (raw[6] === "Y") small.push(code);
  }
  if (!naics.some(isTargetNaics)) return null;
  let website = blank(f[F.url]);
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
  return {
    uei: f[F.uei].trim(),
    cage: blank(f[F.cage]),
    legal_name: f[F.legalName].trim(),
    dba_name: blank(f[F.dba]),
    address: blank(f[F.address]),
    city: blank(f[F.city]),
    state: blank(f[F.state]),
    zip5: blank(f[F.zip5])?.slice(0, 5) ?? null,
    website,
    naics,
    small_naics: small,
    business_types: (f[F.businessTypes] ?? "").split("~").map((s) => s.trim()).filter(Boolean),
    poc_name: [blank(f[F.pocFirst]), blank(f[F.pocLast])].filter(Boolean).join(" ") || null,
    registration_expires: yyyymmdd(f[F.expires]),
  };
}

/**
 * Stream the nested ZIP and emit matching entities. Works on a fetch body
 * or a file stream; memory stays flat (~one chunk + one line).
 */
export async function streamSamEntities(
  body: ReadableStream<Uint8Array>,
  onEntity: (e: SamEntity) => void | Promise<void>
): Promise<{ records: number; matched: number }> {
  const decoder = new TextDecoder("utf-8");
  let carry = "";
  let records = 0;
  let matched = 0;
  const pending: SamEntity[] = [];

  const handleText = (text: string) => {
    carry += text;
    let nl: number;
    while ((nl = carry.indexOf("\n")) >= 0) {
      const line = carry.slice(0, nl).replace(/\r$/, "");
      carry = carry.slice(nl + 1);
      if (!line) continue;
      records++;
      const e = parseEntityLine(line);
      if (e) pending.push(e);
    }
  };

  const inner = new Unzip((file) => {
    if (!file.name.toLowerCase().endsWith(".dat")) return;
    file.ondata = (err, chunk, final) => {
      if (err) throw err;
      handleText(decoder.decode(chunk, { stream: !final }));
    };
    file.start();
  });
  inner.register(UnzipInflate);
  inner.register(UnzipPassThrough);

  const outer = new Unzip((file) => {
    file.ondata = (err, chunk, final) => {
      if (err) throw err;
      inner.push(chunk, final);
    };
    file.start();
  });
  outer.register(UnzipInflate);
  outer.register(UnzipPassThrough);

  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    outer.push(value ?? new Uint8Array(), done);
    // Drain parsed entities between chunks so async consumers apply backpressure.
    while (pending.length) {
      matched++;
      await onEntity(pending.shift()!);
    }
    if (done) break;
  }
  if (carry.trim()) {
    records++;
    const e = parseEntityLine(carry);
    if (e) {
      matched++;
      await onEntity(e);
    }
  }
  return { records, matched };
}

/** Latest monthly UTF-8 public extract file name. */
export async function latestSamEntityFile(): Promise<string> {
  const res = await fetch(SAM_ENTITY_LIST_URL, { headers: { Accept: "application/hal+json, application/json" } });
  const data = (await res.json()) as { _embedded?: { customS3ObjectSummaryList?: Array<{ displayKey: string }> } };
  const names = (data._embedded?.customS3ObjectSummaryList ?? [])
    .map((x) => x.displayKey)
    .filter((n) => /^SAM_PUBLIC_UTF-8_MONTHLY_V2_\d{8}\.ZIP$/i.test(n))
    .sort();
  if (!names.length) throw new Error("No SAM public monthly extract found");
  return names[names.length - 1];
}
