"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, ChevronRight, Loader2, MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ZonePhotos } from "@/components/job/marked-photo";
import { AreaTodo } from "@/components/job/area-todo";
import { createClient } from "@/lib/supabase/client";
import { sendOrKeep } from "@/lib/offline/outbox-send";
import { useOnSent, useWaiting, WaitingPhotos } from "@/components/offline/waiting-photos";
import { angleLine, zoneProgress } from "@/lib/guided-zones";
import { canvasImageUrl } from "@/lib/canvas-image-url";
import type { WorkOrderZone } from "@/lib/work-order";
import type { JobPhotoWithUrl } from "@/lib/data/job-photos";

/**
 * The work, one area at a time, for somebody on site.
 *
 * Shows the area to start on with the evaluation's photo of it, takes the
 * after photo from the same angle, and only then shows the next area.
 * Nothing skips: the next area is the first one without an after photo,
 * read off the photos themselves.
 */
export function GuidedZones({ jobId, zones, photos }: { jobId: string; zones: WorkOrderZone[]; photos: JobPhotoWithUrl[] }) {
  const router = useRouter();
  const [items, setItems] = useState<JobPhotoWithUrl[]>(photos);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const fileInput = useRef<HTMLInputElement | null>(null);

  const scope = `job:${jobId}`;
  // An after photo kept on the phone with no signal counts: the crew moves on, and it uploads later.
  const waiting = useWaiting(scope).filter((w) => w.kind === "job-photo" && w.args.kind === "after");
  const waitingZone = (w: (typeof waiting)[number]) => (w.args.zone as { id: string } | null)?.id ?? null;
  const progress = zoneProgress(
    zones.map((z) => ({ id: z.id, name: z.name })),
    [...items.map((p) => ({ zoneId: p.zoneId, kind: p.kind })), ...waiting.map((w) => ({ zoneId: waitingZone(w), kind: "after" as const }))]
  );
  const current = progress.current ? zones.find((z) => z.id === progress.current!.id) ?? null : null;
  const number = current ? zones.findIndex((z) => z.id === current.id) + 1 : 0;
  const afterHere = current ? items.filter((p) => p.kind === "after" && p.zoneId === current.id) : [];

  function addPhoto(id: string, path: string, zone: { id: string; name: string }, url: string | null) {
    setItems((all) =>
      all.some((p) => p.id === id)
        ? all
        : [
            ...all,
            {
              id,
              job_id: jobId,
              organization_id: "",
              path,
              kind: "after",
              zone_id: zone.id,
              zoneId: zone.id,
              zone_name: zone.name,
              caption: null,
              uploaded_by: null,
              created_at: new Date().toISOString(),
              url,
              uploaderName: null,
            },
          ]
    );
  }

  // A photo kept with no signal joins the rest once it is sent.
  useOnSent(scope, (item, result) => {
    const zone = item.args.zone as { id: string; name: string } | null;
    if (item.kind !== "job-photo" || item.args.kind !== "after" || !zone) return;
    addPhoto(String(result.id), String(result.path), zone, item.blob ? URL.createObjectURL(item.blob) : null);
  });

  async function upload(files: FileList | null) {
    if (!files || files.length === 0 || !current) return;
    setError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `${jobId}/${crypto.randomUUID()}.${extension}`;
        const zone = { id: current.id, name: current.name };
        const sent = await sendOrKeep({ kind: "job-photo", scope, label: `After photo · ${current.name}`, blob: file, type: file.type, args: { jobId, path, kind: "after", zone, areaDone: false } });
        if (sent.status === "refused") {
          setError(sent.message);
          continue;
        }
        if (sent.status === "kept") continue;
        const { data: signed } = await createClient().storage.from("job-photos").createSignedUrl(path, 60 * 60);
        addPhoto(String(sent.result.id), path, zone, signed?.signedUrl ?? null);
      }
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }


  if (zones.length === 0) {
    return <p className="rounded-xl border border-amber-400/60 bg-amber-50/60 p-4 text-sm">No areas have been marked on this job yet. Check with Jordan before you start.</p>;
  }

  if (!current) {
    return (
      <section className="rounded-xl border border-emerald-600/40 bg-emerald-50/60 p-4">
        <p className="flex items-center gap-2 text-base font-semibold">
          <Check className="h-5 w-5 text-emerald-700" />
          All {zones.length} areas done and photographed.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">Tell Jordan you are finished. Nothing else to do here.</p>
        <DoneList zones={zones} items={items} />
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-xl border-2 border-primary bg-card/80 p-4 backdrop-blur-md">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
          {progress.done.length === 0 ? "Start here" : "Next"} · area {progress.position} of {progress.total}
        </p>
        <div className="mt-1 flex items-start gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style={{ backgroundColor: current.color }}>
            {number}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold leading-snug">{current.name}</p>
            <p className="text-sm text-primary">{current.service}</p>
            {(current.location || current.sizeLabel) && (
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                {current.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {current.location}
                  </span>
                )}
                {current.sizeLabel && <span>{current.sizeLabel}</span>}
              </p>
            )}
          </div>
        </div>

        <div className="mt-3">
          <ZonePhotos photos={current.photos} zoneName={current.name} />
        </div>
        <AreaTodo todo={current.todo} className="mt-1" />
        {current.notes && <p className="mt-2 rounded-lg border border-amber-400/50 bg-amber-50/60 p-2.5 text-sm">{current.notes}</p>}

        {/* The after photo, from the same angle. The next area waits on it. */}
        <div className="mt-3 rounded-lg border border-dashed border-primary/50 bg-primary/5 p-3">
          <p className="text-sm font-semibold">When this area is done, take the after photo.</p>
          {/* The before, right beside the camera button: the after is taken
              standing where this was, pointing the same way. */}
          {current.photos[0] && (
            // eslint-disable-next-line @next/next/no-img-element -- public evaluation photo, shown as taken
            <img
              src={canvasImageUrl(current.photos[0].path)}
              alt={`Before, ${current.name}`}
              className="mt-2 max-h-56 w-full rounded-md border object-contain"
            />
          )}
          <p className="mt-0.5 text-xs text-muted-foreground">{angleLine(current.photos.length)}</p>
          {afterHere.length > 0 && (
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {afterHere.map((p) =>
                p.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={p.id} src={p.url} alt={`After, ${current.name}`} className="aspect-[3/4] w-full rounded-md object-cover" />
                ) : null
              )}
            </div>
          )}
          <div className="mt-2 empty:hidden">
            <WaitingPhotos scope={scope} filter={(w) => w.kind === "job-photo" && w.args.kind === "after" && (w.args.zone as { id: string } | null)?.id === current.id} />
          </div>
          <input ref={fileInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => upload(e.target.files)} />
          <Button type="button" variant={afterHere.length > 0 ? "outline" : "default"} className="mt-2 h-12 w-full text-base" disabled={uploading} onClick={() => fileInput.current?.click()}>
            {uploading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Camera className="mr-2 h-5 w-5" />}
            {afterHere.length > 0 ? "Take another after photo" : "Take the after photo"}
          </Button>
          {error && <p className="mt-2 text-sm font-medium text-destructive">{error}</p>}
        </div>

        <Button
          type="button"
          className="mt-3 h-14 w-full text-base font-semibold"
          disabled={afterHere.length === 0 || uploading}
          title={afterHere.length === 0 ? "Take the after photo first." : undefined}
          onClick={() => start(() => router.refresh())}
        >
          <ChevronRight className="mr-2 h-5 w-5" />
          {progress.position < progress.total ? "Done here, show the next area" : "Done here, finish up"}
        </Button>
        {afterHere.length === 0 && <p className="mt-1 text-center text-xs text-muted-foreground">The next area appears once the after photo is in.</p>}
      </section>

      <DoneList zones={zones} items={items} />
    </div>
  );
}

function DoneList({ zones, items }: { zones: WorkOrderZone[]; items: JobPhotoWithUrl[] }) {
  const done = zones.filter((z) => items.some((p) => p.kind === "after" && p.zoneId === z.id));
  if (done.length === 0) return null;
  return (
    <section className="rounded-xl border border-border bg-card/60 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Done</p>
      <ul className="mt-1 flex flex-col gap-1 text-sm">
        {done.map((z) => (
          <li key={z.id} className="flex items-center gap-2">
            <Check className="h-4 w-4 text-emerald-700" />
            <span className="font-medium">{z.name}</span>
            <span className="text-muted-foreground">· {z.service}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
