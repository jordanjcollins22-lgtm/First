import { isSupabaseAdminConfigured } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  CASE_FILES_BUCKET,
  type CaseFile,
  caseFilesFromObjects,
  formatFileSize,
  isCaseFilesToken,
} from "@/lib/case-files";

/**
 * A shared folder of files, where a link we hand to someone outside the
 * business lands: every video plays in the page, every photo shows, and each
 * file (or all of them as one zip) downloads.
 *
 * No sign-in, like a receipt: the random token in the address is the whole
 * authorisation, and the folder holds only what we chose to share.
 */
export const dynamic = "force-dynamic";

type Meta = { title?: string; subtitle?: string; note?: string };

export default async function SharedFilesPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isSupabaseAdminConfigured || !isCaseFilesToken(token)) return <NotFound />;

  const storage = createAdminClient().storage.from(CASE_FILES_BUCKET);
  const { data, error } = await storage.list(token, { limit: 200 });
  if (error || !data) return <NotFound />;

  const objects = data
    .filter((o) => o.id)
    .map((o) => ({ name: o.name, size: (o.metadata as { size?: number } | null)?.size ?? null }));
  const meta = objects.some((o) => o.name === "meta.json") ? await readMeta(storage, token) : {};
  const files = caseFilesFromObjects(objects.filter((o) => o.name !== "meta.json"));
  if (files.length === 0) return <NotFound />;

  const url = (name: string, download = false) =>
    storage.getPublicUrl(`${token}/${name}`, download ? { download: name } : undefined).data.publicUrl;

  const zip = files.find((f) => f.kind === "zip");
  const shown = files.filter((f) => f.kind !== "zip");

  return (
    <main className="min-h-full bg-[#f4f6f3] px-4 py-8 text-[#14181a]">
      <div className="mx-auto w-full max-w-3xl">
        <header className="overflow-hidden rounded-2xl border border-[#e3e7e2] bg-white shadow-sm">
          <div className="flex items-center gap-3 border-b-4 border-[#2f6d3c] px-5 py-5 sm:px-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark.png" alt="" className="h-12 w-12 rounded-lg bg-[#2f6d3c] object-contain p-1" />
            <div>
              <p className="text-lg font-bold leading-tight">JS Landscaping</p>
              <p className="text-xs uppercase tracking-wide text-[#5b6660]">Shared files</p>
            </div>
          </div>
          <div className="px-5 py-5 sm:px-8">
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{meta.title ?? "Shared files"}</h1>
            {meta.subtitle && <p className="mt-1 text-sm text-[#5b6660]">{meta.subtitle}</p>}
            {meta.note && <p className="mt-3 text-sm">{meta.note}</p>}
            {zip && (
              <a
                href={url(zip.name, true)}
                className="mt-5 flex items-center justify-center gap-2 rounded-xl bg-[#2f6d3c] px-4 py-3 text-center font-semibold text-white hover:bg-[#275c33]"
              >
                Download everything
                <span className="font-normal text-white/80">(.zip, {formatFileSize(zip.size)})</span>
              </a>
            )}
          </div>
        </header>

        <ol className="mt-6 flex flex-col gap-5">
          {shown.map((file) => (
            <li key={file.name} className="overflow-hidden rounded-2xl border border-[#e3e7e2] bg-white shadow-sm">
              <FilePreview file={file} src={url(file.name)} />
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="font-semibold">{file.label}</p>
                  <p className="text-xs uppercase tracking-wide text-[#5b6660]">
                    {kindLabel(file)}
                    {file.size != null && ` · ${formatFileSize(file.size)}`}
                  </p>
                </div>
                <div className="flex gap-2">
                  <a
                    href={url(file.name)}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-[#cfd6cd] px-3 py-2 text-sm font-medium hover:bg-[#f4f6f3]"
                  >
                    Open
                  </a>
                  <a
                    href={url(file.name, true)}
                    className="rounded-lg bg-[#2f6d3c] px-3 py-2 text-sm font-semibold text-white hover:bg-[#275c33]"
                  >
                    Download
                  </a>
                </div>
              </div>
            </li>
          ))}
        </ol>

        <p className="mt-8 text-center text-xs text-[#5b6660]">
          JS Landscaping · app.jslandscapingmd.com
        </p>
      </div>
    </main>
  );
}

function FilePreview({ file, src }: { file: CaseFile; src: string }) {
  if (file.kind === "video") {
    return (
      <video controls playsInline preload="metadata" className="aspect-video w-full bg-black">
        <source src={src} type={file.name.toLowerCase().endsWith(".mov") ? "video/mp4" : undefined} />
      </video>
    );
  }
  if (file.kind === "image") {
    return (
      <a href={src} target="_blank" rel="noreferrer" className="block bg-[#eef1ec]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={file.label} loading="lazy" className="mx-auto max-h-[70vh] w-auto object-contain" />
      </a>
    );
  }
  if (file.kind === "pdf") {
    return <iframe src={src} title={file.label} className="hidden h-[70vh] w-full border-0 bg-[#eef1ec] sm:block" />;
  }
  return null;
}

function kindLabel(file: CaseFile): string {
  switch (file.kind) {
    case "video":
      return "Video";
    case "image":
      return "Photo";
    case "pdf":
      return "PDF";
    case "zip":
      return "Zip";
    default:
      return "File";
  }
}

async function readMeta(
  storage: ReturnType<ReturnType<typeof createAdminClient>["storage"]["from"]>,
  token: string
): Promise<Meta> {
  const { data } = await storage.download(`${token}/meta.json`);
  if (!data) return {};
  try {
    const parsed = JSON.parse(await data.text()) as Meta;
    return {
      title: typeof parsed.title === "string" ? parsed.title : undefined,
      subtitle: typeof parsed.subtitle === "string" ? parsed.subtitle : undefined,
      note: typeof parsed.note === "string" ? parsed.note : undefined,
    };
  } catch {
    return {};
  }
}

function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-20 text-center">
      <p className="text-lg font-semibold">We cannot find these files.</p>
      <p className="text-sm text-muted-foreground">The link may have expired. Ask JS Landscaping for a fresh one.</p>
    </div>
  );
}
