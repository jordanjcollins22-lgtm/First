"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { shrinkImage } from "@/lib/shrink-image";
import { addBacklogPhoto, backlogUploadSlot } from "@/lib/actions/social-backlog-actions";
import { draftCaption, draftText } from "@/lib/social/photo-drafts";

interface Picked {
  key: string;
  file: File;
  url: string;
  town: string;
  service: string;
  note: string;
  status: "ready" | "sending" | "done" | "failed";
  message?: string;
}

/**
 * The photo backlog: drop photos in (or pick them on the phone), say the
 * town and the service if you like, and each one becomes a draft post in
 * "Ready to approve" with its caption and a suggested time.
 *
 * mode "preview" (the review page) saves nothing: picking a photo shows
 * the draft that would be made, right here in the browser.
 */
export function PhotoBacklog({
  mode = "live",
  counts,
  phone,
  bookingUrl,
  idPrefix = "",
}: {
  mode?: "live" | "preview";
  counts?: { total: number; drafted: number } | null;
  phone: string;
  bookingUrl: string;
  idPrefix?: string;
}) {
  const [picked, setPicked] = useState<Picked[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Object URLs are let go when the list changes or the page closes.
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  function add(files: FileList | File[] | null) {
    const list = [...(files ?? [])].filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;
    setNotice(null);
    setPicked((p) => [
      ...p,
      ...list.map((file) => {
        const url = URL.createObjectURL(file);
        urls.current.push(url);
        return { key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`, file, url, town: "", service: "", note: "", status: "ready" as const };
      }),
    ]);
  }

  const update = (key: string, patch: Partial<Picked>) => setPicked((p) => p.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const remove = (key: string) => setPicked((p) => p.filter((x) => x.key !== key));

  async function send() {
    setBusy(true);
    setNotice(null);
    let made = 0;
    for (const item of picked.filter((x) => x.status === "ready" || x.status === "failed")) {
      update(item.key, { status: "sending", message: undefined });
      try {
        const small = await shrinkImage(item.file, 2048, 0.88).catch(() => item.file);
        const slot = await backlogUploadSlot(small.type || "image/jpeg", small.size);
        if (!slot.ok || !slot.path || !slot.token) {
          update(item.key, { status: "failed", message: slot.message });
          continue;
        }
        const sent = await createClient().storage.from("job-photos").uploadToSignedUrl(slot.path, slot.token, small, { contentType: small.type || "image/jpeg" });
        if (sent.error) {
          update(item.key, { status: "failed", message: "That photo wouldn't upload. Try again." });
          continue;
        }
        const r = await addBacklogPhoto({ path: slot.path, town: item.town, service: item.service, note: item.note });
        update(item.key, { status: r.ok ? "done" : "failed", message: r.message });
        if (r.ok) made++;
      } catch {
        update(item.key, { status: "failed", message: "Something went wrong. Try again." });
      }
    }
    setBusy(false);
    if (made) {
      setNotice(`${made} draft post${made === 1 ? "" : "s"} made. They're at the top, in Ready to approve.`);
      setPicked((p) => p.filter((x) => x.status !== "done"));
      router.refresh();
    }
  }

  const waiting = picked.filter((x) => x.status === "ready" || x.status === "failed").length;

  return (
    <section id={`${idPrefix}upload`} className="mx-auto mb-8 max-w-3xl px-4">
      <h2 className="text-xl font-bold">Photo backlog</h2>
      <p className="text-sm text-muted-foreground">
        Add photos of finished work and each one is turned into a post, ready to approve. Town and service are optional; they make the caption better. Only the town
        is ever said, never the street or the client.
        {counts ? ` ${counts.total} photo${counts.total === 1 ? "" : "s"} uploaded so far, ${counts.drafted} turned into posts.` : ""}
      </p>

      <div
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          add(e.dataTransfer.files);
        }}
        className={`mt-3 flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center ${dragging ? "border-primary bg-primary/5" : "border-border"}`}
      >
        <ImagePlus className="h-8 w-8 text-muted-foreground" />
        <span className="font-semibold">Tap to choose photos, or drop them here</span>
        <span className="text-xs text-muted-foreground">One or many, straight from the phone camera roll.</span>
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {mode === "live" && counts === null && (
        <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          Uploads need migration 0376_social_photo_backlog.sql applied first (Admin › Database). Crew job photos still turn into drafts without it.
        </p>
      )}

      {picked.length > 0 && (
        <ul className="mt-4 flex flex-col gap-4">
          {picked.map((p, i) => {
            const draft = draftText({ shape: "upload", town: p.town || null, service: p.service || null, note: p.note || null, phone, bookingUrl });
            return (
              <li key={p.key} id={`${idPrefix}upload-draft-${i + 1}`} className="grid gap-3 rounded-xl border bg-card/70 p-3 sm:grid-cols-[160px_1fr]">
                {/* eslint-disable-next-line @next/next/no-img-element -- a local photo picked on this device */}
                <img src={p.url} alt="Picked photo" className="aspect-square w-full rounded-lg object-cover" />
                <div className="flex flex-col gap-2">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input placeholder="Town (e.g. Bel Air)" value={p.town} onChange={(e) => update(p.key, { town: e.target.value })} disabled={p.status === "sending"} />
                    <Input placeholder="Service (e.g. Mulching)" value={p.service} onChange={(e) => update(p.key, { service: e.target.value })} disabled={p.status === "sending"} />
                  </div>
                  <Input placeholder="Note for the caption (optional)" value={p.note} onChange={(e) => update(p.key, { note: e.target.value })} disabled={p.status === "sending"} />
                  {mode === "preview" && (
                    <div className="rounded-md border bg-muted/30 p-2 text-sm">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">The draft this makes (not saved)</p>
                      <p className="mt-1 whitespace-pre-line">{draftCaption(draft)}</p>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    {p.status === "sending" && <Loader2 className="h-4 w-4 animate-spin" />}
                    {p.message && <span className={`text-xs ${p.status === "failed" ? "text-red-700" : "text-emerald-700"}`}>{p.message}</span>}
                    {p.status !== "sending" && (
                      <Button size="sm" variant="ghost" className="ml-auto" onClick={() => remove(p.key)}>
                        <X className="h-4 w-4" /> Remove
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {mode === "live" && waiting > 0 && (
        <Button size="lg" className="mt-4 w-full sm:w-auto" disabled={busy} onClick={send}>
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />} Turn {waiting} photo{waiting === 1 ? "" : "s"} into posts
        </Button>
      )}
      {notice && <p className="mt-2 text-sm text-emerald-700">{notice}</p>}
    </section>
  );
}
