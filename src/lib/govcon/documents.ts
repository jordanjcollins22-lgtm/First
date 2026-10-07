import mammoth from "mammoth";

import type { SolicitationDocument } from "./ai";
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
    if (![".pdf", ".docx", ".txt"].includes(att.extension)) {
      skipped.push(att.name);
      continue;
    }
    const bytes = await downloadAttachment(att).catch(() => null);
    if (!bytes || total + bytes.byteLength > maxTotalBytes) {
      skipped.push(att.name);
      continue;
    }
    total += bytes.byteLength;
    if (att.extension === ".pdf") {
      documents.push({ name: att.name, kind: "pdf", base64: Buffer.from(bytes).toString("base64") });
    } else if (att.extension === ".docx") {
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      documents.push({ name: att.name, kind: "text", text: value });
    } else {
      documents.push({ name: att.name, kind: "text", text: new TextDecoder().decode(bytes) });
    }
  }
  return { documents, attachments, skipped };
}
