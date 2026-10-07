import mammoth from "mammoth";

import type { Db } from "./pipeline/context";
import type { SolicitationDocument } from "./ai";
import { xlsxToText } from "./xlsx";
import { downloadAttachment, listAttachments, rankAttachments, type SamAttachment } from "./sources/sam-attachments";

/**
 * Pull a notice's most useful attachments (SOW/PWS first) and convert them
 * into documents Claude can read: PDFs are passed through natively, Word
 * files are converted to text. Total size is capped to stay well under the
 * 32 MB request limit.
 */
export async function loadSolicitationDocuments(
  noticeId: string,
  { maxDocs = 6, maxTotalBytes = 18_000_000 } = {}
): Promise<{ documents: SolicitationDocument[]; attachments: SamAttachment[]; skipped: string[] }> {
  const attachments = rankAttachments(await listAttachments(noticeId).catch(() => []));
  const documents: SolicitationDocument[] = [];
  const skipped: string[] = [];
  let total = 0;

  for (const att of attachments) {
    if (documents.length >= maxDocs) {
      skipped.push(att.name);
      continue;
    }
    if (!SUPPORTED.includes(att.extension)) {
      skipped.push(att.name);
      continue;
    }
    const bytes = await downloadAttachment(att).catch(() => null);
    if (!bytes || total + bytes.byteLength > maxTotalBytes) {
      skipped.push(att.name);
      continue;
    }
    total += bytes.byteLength;
    const doc = await toDocument(att.name, att.extension, bytes);
    if (doc) documents.push(doc);
    else skipped.push(att.name);
  }
  return { documents, attachments, skipped };
}

const SUPPORTED = [".pdf", ".docx", ".txt", ".xlsx"];

/** Convert raw bytes into something Claude can read (PDF native, others → text). */
export async function toDocument(name: string, extension: string, bytes: Uint8Array): Promise<SolicitationDocument | null> {
  try {
    if (extension === ".pdf") return { name, kind: "pdf", base64: Buffer.from(bytes).toString("base64") };
    if (extension === ".docx") {
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      return { name, kind: "text", text: value };
    }
    if (extension === ".xlsx") return { name, kind: "text", text: xlsxToText(bytes) };
    if (extension === ".txt") return { name, kind: "text", text: new TextDecoder().decode(bytes) };
  } catch {
    return null;
  }
  return null;
}

export interface UploadedDoc {
  name: string;
  path: string; // in the govcon-docs bucket
  size: number;
}

/** Documents a human uploaded on the opportunity page (portal bids). */
export async function loadUploadedDocuments(db: Db, docs: UploadedDoc[]): Promise<SolicitationDocument[]> {
  const out: SolicitationDocument[] = [];
  for (const d of docs.slice(0, 8)) {
    const { data } = await db.storage.from("govcon-docs").download(d.path);
    if (!data) continue;
    const ext = d.name.slice(d.name.lastIndexOf(".")).toLowerCase();
    const doc = await toDocument(d.name, ext, new Uint8Array(await data.arrayBuffer()));
    if (doc) out.push(doc);
  }
  return out;
}
