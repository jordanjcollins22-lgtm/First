import { isSupabaseAdminConfigured } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  CASE_FILES_BUCKET,
  type CaseFile,
  type CaseLayout,
  caseFilesFromObjects,
  formatFileSize,
  isCaseFilesToken,
  parseCaseLayout,
} from "@/lib/case-files";

/**
 * A shared folder of files, where a link we hand to someone outside the
 * business (our lawyer) lands.
 *
 * With a layout.json in the folder it reads as one document: a single
 * download at the top, then sections to scroll through with every page shown
 * full width and every video playable. Without one, it falls back to a card
 * per file with its own download.
 *
 * No sign-in, like a receipt: the random token in the address is the whole
 * authorisation, and the folder holds only what we chose to share.
 */
export const dynamic = "force-dynamic";

type Storage = ReturnType<ReturnType<typeof createAdminClient>["storage"]["from"]>;
type Meta = { title?: string; subtitle?: string; note?: string };

export default async function SharedFilesPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isSupabaseAdminConfigured || !isCaseFilesToken(token)) return <NotFound />;

  const storage = createAdminClient().storage.from(CASE_FILES_BUCKET);
  const { data, error } = await storage.list(token, { limit: 500 });
  if (error || !data) return <NotFound />;

  const objects = data
    .filter((o) => o.id)
    .map((o) => ({ name: o.name, size: (o.metadata as { size?: number } | null)?.size ?? null }));
  const names = new Set(objects.map((o) => o.name));

  const url = (name: string, download = false) =>
    storage.getPublicUrl(`${token}/${name}`, download ? { download: name } : undefined).data.publicUrl;

  if (names.has("layout.json")) {
    const layout = parseCaseLayout(await readJson(storage, token, "layout.json"), objects);
    if (layout) return <DocumentView layout={layout} url={url} />;
  }

  const meta = names.has("meta.json") ? toMeta(await readJson(storage, token, "meta.json")) : {};
  const files = caseFilesFromObjects(objects.filter((o) => !o.name.endsWith(".json")));
  if (files.length === 0) return <NotFound />;
  return <ListView meta={meta} files={files} url={url} />;
}

/** One document: a single download, then everything to scroll through. */
function DocumentView({ layout, url }: { layout: CaseLayout; url: (name: string, download?: boolean) => string }) {
  return (
    <Shell>
      <Header title={layout.title} subtitle={layout.subtitle}>
        {layout.download && (
          <a
            href={url(layout.download.file.name, true)}
            className="mt-5 flex flex-col items-center justify-center rounded-xl bg-[#2f6d3c] px-4 py-3 text-center font-semibold text-white hover:bg-[#275c33] sm:flex-row sm:gap-2"
          >
            {layout.download.label}
            {layout.download.file.size != null && (
              <span className="text-sm font-normal text-white/80">{formatFileSize(layout.download.file.size)}</span>
            )}
          </a>
        )}
        {layout.sections.length > 1 && (
          <nav className="mt-5 flex flex-wrap gap-2 text-sm">
            {layout.sections.map((s, i) => (
              <a
                key={s.title}
                href={`#s${i + 1}`}
                className="rounded-full border border-[#cfd6cd] px-3 py-1 text-[#1f4d2c] hover:bg-[#f4f6f3]"
              >
                {s.title}
              </a>
            ))}
          </nav>
        )}
      </Header>

      {layout.sections.map((section, i) => (
        <section key={section.title} id={`s${i + 1}`} className="mt-8 scroll-mt-4">
          <h2 className="text-lg font-bold tracking-tight">{section.title}</h2>
          {section.note && <p className="mt-1 text-sm text-[#5b6660]">{section.note}</p>}
          <div className="mt-3 flex flex-col gap-4">
            {section.files.map((file) => (
              <div key={file.name} className="overflow-hidden rounded-xl border border-[#e3e7e2] bg-white shadow-sm">
                <FilePreview file={file} src={url(file.name)} full />
              </div>
            ))}
          </div>
        </section>
      ))}
    </Shell>
  );
}

/** A card per file, each with its own open and download. */
function ListView({ meta, files, url }: { meta: Meta; files: CaseFile[]; url: (name: string, download?: boolean) => string }) {
  const zip = files.find((f) => f.kind === "zip");
  const shown = files.filter((f) => f.kind !== "zip");
  return (
    <Shell>
      <Header title={meta.title} subtitle={meta.subtitle}>
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
      </Header>
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
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-full bg-[#f4f6f3] px-4 py-8 text-[#14181a]">
      <div className="mx-auto w-full max-w-3xl">
        {children}
        <p className="mt-10 text-center text-xs text-[#5b6660]">JS Landscaping · app.jslandscapingmd.com</p>
      </div>
    </main>
  );
}

function Header({ title, subtitle, children }: { title?: string; subtitle?: string; children?: React.ReactNode }) {
  return (
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
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title ?? "Shared files"}</h1>
        {subtitle && <p className="mt-1 text-sm text-[#5b6660]">{subtitle}</p>}
        {children}
      </div>
    </header>
  );
}

function FilePreview({ file, src, full = false }: { file: CaseFile; src: string; full?: boolean }) {
  if (file.kind === "video") {
    return (
      <video controls playsInline preload="metadata" className="aspect-video w-full bg-black">
        <source src={src} type={file.name.toLowerCase().endsWith(".mov") ? "video/mp4" : undefined} />
      </video>
    );
  }
  if (file.kind === "image") {
    return (
      <a href={src} target="_blank" rel="noreferrer" className="block bg-white" title="Open full size">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={file.label}
          loading="lazy"
          className={full ? "block h-auto w-full" : "mx-auto max-h-[70vh] w-auto object-contain"}
        />
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

async function readJson(storage: Storage, token: string, name: string): Promise<unknown> {
  const { data } = await storage.download(`${token}/${name}`);
  if (!data) return null;
  try {
    return JSON.parse(await data.text());
  } catch {
    return null;
  }
}

function toMeta(raw: unknown): Meta {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : undefined);
  return { title: s(r.title), subtitle: s(r.subtitle), note: s(r.note) };
}

function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-20 text-center">
      <p className="text-lg font-semibold">We cannot find these files.</p>
      <p className="text-sm text-muted-foreground">The link may have expired. Ask JS Landscaping for a fresh one.</p>
    </div>
  );
}
