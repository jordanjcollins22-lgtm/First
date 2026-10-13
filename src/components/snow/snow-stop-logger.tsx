"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Camera, CheckCircle2, MapPin, Navigation } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { shrinkImage } from "@/lib/shrink-image";
import { logSnowStop, snowRecommendation, snowStopPhotoSlot, type LogStopInput } from "@/lib/actions/snow-actions";
import { PRODUCT_LABEL, PRODUCTS, type SaltProduct } from "@/lib/snow/application";
import type { SnowStop } from "@/lib/data/snow-ops";

/**
 * The crew's snow route, one stop at a time.
 *
 * Built for a gloved thumb at five in the morning: the next stop is open on
 * its own, the surface temperature is the one number that has to be typed,
 * and the amount to put down comes back from it. The time is stamped by the
 * server and the position is taken from the phone when the stop is opened,
 * so the record proves itself rather than relying on anyone's memory. A
 * photo is required: it is the client's proof we came.
 */

const SERVICES: { value: LogStopInput["service"]; label: string }[] = [
  { value: "salt", label: "Salt" },
  { value: "plow_and_salt", label: "Plow + salt" },
  { value: "plow", label: "Plow only" },
  { value: "pretreat", label: "Pre-treat" },
];

export function SnowStopLogger({
  event,
  stops,
  defaultService = "salt",
}: {
  event: { id: string; label: string };
  stops: SnowStop[];
  defaultService?: "pretreat" | "salt" | "plow";
}) {
  const firstOpen = stops.find((s) => s.status === "pending")?.id ?? null;
  const [openId, setOpenId] = useState<string | null>(firstOpen);
  const done = stops.filter((s) => s.status !== "pending").length;

  return (
    <section className="grid gap-3">
      <header className="rounded-xl border bg-card p-4">
        <h2 className="text-lg font-bold">{event.label}</h2>
        <p className="text-sm text-muted-foreground">
          {done} of {stops.length} stops logged
        </p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary" style={{ width: `${stops.length ? (done / stops.length) * 100 : 0}%` }} />
        </div>
      </header>
      <ol className="grid gap-2">
        {stops.map((stop) => (
          <li key={stop.id} className="rounded-xl border bg-card">
            <button
              type="button"
              aria-expanded={openId === stop.id}
              onClick={() => setOpenId(openId === stop.id ? null : stop.id)}
              className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left"
            >
              <span className="font-mono text-sm text-muted-foreground">{stop.position}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{stop.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{stop.address}</span>
              </span>
              {stop.status === "done" && <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-label="Done" />}
              {stop.status === "skipped" && <span className="text-xs text-orange-700 dark:text-orange-300">Skipped</span>}
            </button>
            {openId === stop.id && (
              <div className="border-t px-4 pb-4 pt-3">
                <StopForm
                  stop={stop}
                  defaultService={defaultService === "plow" ? "plow_and_salt" : defaultService}
                  onLogged={() => {
                    const next = stops.find((s) => s.status === "pending" && s.id !== stop.id);
                    setOpenId(next?.id ?? null);
                  }}
                />
              </div>
            )}
          </li>
        ))}
      </ol>
      {stops.length === 0 && <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">No stops on this route.</p>}
    </section>
  );
}

function StopForm({ stop, defaultService, onLogged }: { stop: SnowStop; defaultService: LogStopInput["service"]; onLogged: () => void }) {
  const [service, setService] = useState<LogStopInput["service"]>(stop.service ?? defaultService);
  const [product, setProduct] = useState<SaltProduct>(stop.product ?? "calcium_chloride");
  const [temp, setTemp] = useState(stop.surfaceTempF != null ? String(stop.surfaceTempF) : "");
  const [pretreated, setPretreated] = useState(false);
  const [lbs, setLbs] = useState(stop.saltLbs != null ? String(stop.saltLbs) : "");
  const [bags, setBags] = useState(stop.saltBags != null ? String(stop.saltBags) : "");
  const [gallons, setGallons] = useState(stop.brineGallons != null ? String(stop.brineGallons) : "");
  const [depth, setDepth] = useState(stop.depthIn != null ? String(stop.depthIn) : "");
  const [pushes, setPushes] = useState(stop.pushes || (service === "plow" || service === "plow_and_salt" ? 1 : 0));
  const [note, setNote] = useState(stop.note ?? "");
  const [skipReason, setSkipReason] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [advice, setAdvice] = useState<{ note: string; pounds: number; works: boolean } | null>(null);
  const [gps, setGps] = useState<LogStopInput["gps"]>(stop.gps);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  // Where the phone is, taken when the stop is opened: the proof it was here.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: Math.round(pos.coords.accuracy) }),
      () => {},
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 }
    );
  }, []);

  // What to put down, once there's a temperature to go on.
  useEffect(() => {
    const t = Number(temp);
    // Nothing typed: the old advice is hidden at render rather than cleared here.
    if (temp === "" || !Number.isFinite(t)) return;
    const timer = setTimeout(async () => {
      const r = await snowRecommendation(stop.id, t, product, pretreated);
      if (r.ok && r.value) setAdvice({ note: r.value.note, pounds: r.value.pounds, works: r.value.works });
    }, 400);
    return () => clearTimeout(timer);
  }, [temp, product, pretreated, stop.id]);

  async function addPhoto(file: File) {
    setUploading(true);
    setMessage(null);
    try {
      const small = await shrinkImage(file).catch(() => file);
      const slot = await snowStopPhotoSlot(stop.id, small.type, small.size);
      if (!slot.ok || !slot.value) {
        setMessage({ text: slot.ok ? "Couldn't make room for the photo." : slot.error, ok: false });
        return;
      }
      const sent = await createClient().storage.from("job-photos").uploadToSignedUrl(slot.value.path, slot.value.token, small, { contentType: small.type });
      if (sent.error) {
        setMessage({ text: "That photo wouldn't upload. Try again.", ok: false });
        return;
      }
      setPhotos((p) => [...p, slot.value!.path]);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const n = (v: string) => (v === "" ? null : Number(v));
  const usesProduct = service !== "plow";

  function submit(status: "done" | "skipped") {
    start(async () => {
      const r = await logSnowStop(stop.id, {
        status,
        surfaceTempF: n(temp),
        depthIn: n(depth),
        service,
        product: usesProduct ? product : "none",
        saltLbs: usesProduct ? n(lbs) : null,
        saltBags: usesProduct ? n(bags) : null,
        brineGallons: product === "brine" ? n(gallons) : null,
        pushes: service === "plow" || service === "plow_and_salt" ? pushes : 0,
        applications: usesProduct ? 1 : 0,
        pretreated,
        photoPaths: photos,
        gps,
        note: note || null,
        skipReason: status === "skipped" ? skipReason : null,
      });
      setMessage({ text: r.ok ? r.message : r.error, ok: r.ok });
      if (r.ok) onLogged();
    });
  }

  const mapsUrl =
    stop.lat != null && stop.lng != null
      ? `https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}`
      : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(stop.address)}`;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        <a href={mapsUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm">
          <Navigation className="h-4 w-4" /> Directions
        </a>
        <span className="inline-flex min-h-11 items-center gap-2 text-xs text-muted-foreground">
          <MapPin className="h-4 w-4" />
          {gps ? `Location taken (±${gps.accuracyM ?? "?"} m)` : "Getting your location…"}
        </span>
      </div>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">What you did</legend>
        <div className="grid grid-cols-2 gap-2">
          {SERVICES.map((s) => (
            <button
              key={s.value}
              type="button"
              aria-pressed={service === s.value}
              onClick={() => setService(s.value)}
              className={`min-h-12 rounded-lg border text-sm font-medium ${service === s.value ? "bg-primary text-primary-foreground" : "bg-card"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1 text-sm">
          <span>Surface temp (°F)</span>
          <input type="number" inputMode="numeric" value={temp} onChange={(e) => setTemp(e.target.value)} className="min-h-12 rounded-lg border bg-background px-3 text-lg" />
        </label>
        <label className="grid gap-1 text-sm">
          <span>Snow depth (in)</span>
          <input type="number" inputMode="decimal" min={0} step={0.5} value={depth} onChange={(e) => setDepth(e.target.value)} className="min-h-12 rounded-lg border bg-background px-3 text-lg" />
        </label>
      </div>

      {usesProduct && (
        <>
          <label className="grid gap-1 text-sm">
            <span>What went down</span>
            <select value={product} onChange={(e) => setProduct(e.target.value as SaltProduct)} className="min-h-12 rounded-lg border bg-background px-3">
              {PRODUCTS.filter((p) => p !== "none").map((p) => (
                <option key={p} value={p}>
                  {PRODUCT_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" className="h-5 w-5" checked={pretreated} onChange={(e) => setPretreated(e.target.checked)} />
            This surface was pre-treated before the storm
          </label>
          {advice && temp !== "" && (
            <p className={`rounded-lg p-3 text-sm ${advice.works ? "bg-muted" : "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100"}`}>
              {advice.note}
              {advice.works && advice.pounds > 0 && lbs === "" && (
                <button type="button" className="ml-2 underline" onClick={() => setLbs(String(advice.pounds))}>
                  Use {advice.pounds} lb
                </button>
              )}
            </p>
          )}
          {product === "brine" ? (
            <label className="grid gap-1 text-sm">
              <span>Brine (gallons)</span>
              <input type="number" inputMode="decimal" min={0} step={0.5} value={gallons} onChange={(e) => setGallons(e.target.value)} className="min-h-12 rounded-lg border bg-background px-3 text-lg" />
            </label>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-sm">
                <span>Pounds</span>
                <input type="number" inputMode="decimal" min={0} step={0.5} value={lbs} onChange={(e) => setLbs(e.target.value)} className="min-h-12 rounded-lg border bg-background px-3 text-lg" />
              </label>
              <label className="grid gap-1 text-sm">
                <span>or bags</span>
                <input type="number" inputMode="decimal" min={0} step={0.5} value={bags} onChange={(e) => setBags(e.target.value)} className="min-h-12 rounded-lg border bg-background px-3 text-lg" />
              </label>
            </div>
          )}
        </>
      )}

      {(service === "plow" || service === "plow_and_salt") && (
        <div className="grid gap-1 text-sm">
          <span>Pushes</span>
          <div className="flex items-center gap-3">
            <Button type="button" variant="secondary" className="min-h-12 min-w-12 text-lg" onClick={() => setPushes(Math.max(0, pushes - 1))}>
              −
            </Button>
            <span className="min-w-8 text-center font-mono text-2xl">{pushes}</span>
            <Button type="button" variant="secondary" className="min-h-12 min-w-12 text-lg" onClick={() => setPushes(pushes + 1)}>
              +
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void addPhoto(file);
          }}
        />
        <Button type="button" variant="secondary" className="min-h-12" disabled={uploading} onClick={() => fileRef.current?.click()}>
          <Camera className="h-5 w-5" />
          {uploading ? "Uploading…" : `Take a photo (${photos.length + stop.photoPaths.length})`}
        </Button>
      </div>

      <label className="grid gap-1 text-sm">
        <span>Note (optional)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} className="min-h-11 rounded-lg border bg-background px-3" />
      </label>

      <Button className="min-h-14 text-base" disabled={pending || uploading} onClick={() => submit("done")}>
        Done here
      </Button>

      <details className="text-sm">
        <summary className="min-h-11 cursor-pointer py-2 text-muted-foreground">Couldn&apos;t do this one</summary>
        <div className="grid gap-2">
          <input
            value={skipReason}
            onChange={(e) => setSkipReason(e.target.value)}
            placeholder="Why? Blocked drive, cars in the lot…"
            className="min-h-11 rounded-lg border bg-background px-3"
          />
          <Button variant="secondary" className="min-h-11" disabled={pending} onClick={() => submit("skipped")}>
            Skip this stop
          </Button>
        </div>
      </details>

      {message && (
        <p role="status" className={`text-sm ${message.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
