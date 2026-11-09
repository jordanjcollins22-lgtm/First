/**
 * Shared case-file folders: a set of files (videos, photos, PDFs) handed to
 * someone outside the business, like our lawyer, behind one link.
 *
 * Files live in the public `case-files` storage bucket under a random token
 * folder. The token is the whole authorisation, the same as a receipt link.
 */

export const CASE_FILES_BUCKET = "case-files";

export type CaseFileKind = "video" | "image" | "pdf" | "zip" | "other";

export type CaseFile = {
  name: string;
  label: string;
  kind: CaseFileKind;
  size: number | null;
};

const KIND_BY_EXT: Record<string, CaseFileKind> = {
  mp4: "video",
  mov: "video",
  m4v: "video",
  webm: "video",
  jpg: "image",
  jpeg: "image",
  png: "image",
  heic: "image",
  webp: "image",
  pdf: "pdf",
  zip: "zip",
};

export function caseFileKind(name: string): CaseFileKind {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return KIND_BY_EXT[ext] ?? "other";
}

/** "2-Bay-Walkthrough-Video-2026-08-20.mp4" -> "Bay Walkthrough Video 2026-08-20" */
export function caseFileLabel(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").replace(/^\d+-/, "");
  return base.replace(/(?<!\d)-|-(?!\d)/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The files to show, in their numbered order. A .mov with an .mp4 of the
 * same name is the original of a copy made to play in every browser, so
 * only the .mp4 is shown. Hidden files (".emptyFolderPlaceholder", "index.html")
 * are left out.
 */
export function caseFilesFromObjects(objects: { name: string; size?: number | null }[]): CaseFile[] {
  const names = new Set(objects.map((o) => o.name));
  return objects
    .filter((o) => !o.name.startsWith("."))
    .filter((o) => o.name.toLowerCase() !== "index.html")
    .filter((o) => !(/\.mov$/i.test(o.name) && names.has(o.name.replace(/\.mov$/i, ".mp4"))))
    .map((o) => ({ name: o.name, label: caseFileLabel(o.name), kind: caseFileKind(o.name), size: o.size ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export function formatFileSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** A token is what we generate: letters, digits, - and _, 16 to 64 long. */
export function isCaseFilesToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{16,64}$/.test(token);
}
