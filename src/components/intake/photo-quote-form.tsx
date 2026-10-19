"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Camera, CheckCircle2, CloudOff, ImagePlus, Loader2, MapPin, Plus, Satellite, Sparkles, Trash2, Wifi, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { INTAKE_QUESTIONS, MAX_SPOTS, PHOTOS_PER_AREA, nextSpotId, type IntakeAnswers, type PhotoQuoteSpot } from "@/lib/evaluation-intake";
import { removeIntakePhoto, saveIntakeProgress, submitEvaluationIntake, suggestSpotIdeas } from "@/lib/actions/evaluation-intake-actions";
import { isHeic, shrinkImage } from "@/lib/shrink-image";
import { sendOrKeep } from "@/lib/offline/outbox-send";
import { removeItem } from "@/lib/offline/outbox";
import { useOnSent, useWaiting } from "@/components/offline/waiting-photos";
import { publicEnv, isMapboxConfigured } from "@/lib/public-env";
import { MAP_CREDIT, groundToPicture, layoutLot, pathOf, pictureToGround, pinView, satelliteUrl, type LotData, type PictureView } from "@/lib/lot-map";

type Photo = { path: string; url: string };

const WIDTH = 640;
const HEIGHT = 440;
/** The kinds of work, as chips under "What do you want done here?". Snow and holiday lights aren't a yard area. */
const SERVICE_CHIPS = (INTAKE_QUESTIONS[0].options ?? []).filter((o) => !["snow", "holiday", "other"].includes(o.value));

/**
 * The pre-evaluation form for a photo quote: a small job priced from what
 * the client sends rather than from a visit.
 *
 * One screen, phone first. Their property from above; they tap where they
 * want work done, and each tap is an area. For each area: what they want
 * done, in a sentence or a chip or two, and a few photos. Somebody who can't
 * take photos says so and we use the satellite. Once an area has photos, a
 * few ideas read off them are offered to tick. Send sends it in.
 *
 * Everything is kept as it goes, as on the visit's form: the areas when they
 * change, the photos the moment each is added, so nothing is lost if they
 * close the page halfway.
 */
export function PhotoQuoteForm({
  token,
  initial,
  initialPhotos,
  submittedAt,
  lot,
  lat,
  lng,
  businessPhone,
  greeting,
}: {
  token: string;
  initial: IntakeAnswers;
  initialPhotos: Photo[];
  submittedAt: string | null;
  lot: LotData | null;
  lat: number | null;
  lng: number | null;
  businessPhone: string | null;
  greeting: string;
}) {
  const [spots, setSpots] = useState<PhotoQuoteSpot[]>(initial.spots);
  const [photos, setPhotos] = useState<Photo[]>(initialPhotos);
  const [photoAreas, setPhotoAreas] = useState<Record<string, string>>(initial.photo_areas);
  const [openId, setOpenId] = useState<string | null>(initial.spots[0]?.id ?? null);
  const [sentAt, setSentAt] = useState<string | null>(submittedAt);
  const [editing, setEditing] = useState(!submittedAt);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // The rest of the answers ride along untouched: a photo quote only fills in its areas.
  const answersOf = (next: PhotoQuoteSpot[]) => ({ ...initial, spots: next });

  // Kept as it goes. A change to where or how many saves at once; typing
  // waits for a pause, so a sentence is one save rather than forty. The
  // latest areas are kept in a ref as well, because an upload or the ideas
  // finish after other changes, and must change what is there by then.
  const latest = useRef(initial.spots);
  const typing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = () => saveIntakeProgress({ token, answers: answersOf(latest.current) }).catch(() => ({ ok: false }));
  function change(next: PhotoQuoteSpot[], now = true) {
    latest.current = next;
    setSpots(next);
    if (typing.current) clearTimeout(typing.current);
    if (now) void save();
    else typing.current = setTimeout(() => void save(), 800);
  }
  useEffect(() => () => {
    if (typing.current) clearTimeout(typing.current);
  }, []);

  // A photo kept on the phone with no signal, sent later by itself.
  useOnSent(`intake:${token}`, (item, result) => {
    if (item.kind !== "intake-photo") return;
    const path = String(result.path);
    setPhotos((all) => (all.some((p) => p.path === path) ? all : [...all, { path, url: String(result.url) }]));
    setPhotoAreas((a) => ({ ...a, [path]: String(result.area) }));
  });

  // Their lot from the county when there is one, turned so the street is at
  // the bottom; otherwise straight down on the pin.
  const layout = useMemo(() => (lot ? layoutLot(lot, WIDTH, HEIGHT, 0) : null), [lot]);
  const view: PictureView | null = layout ?? (lat != null && lng != null ? pinView(lng, lat, WIDTH, HEIGHT) : null);

  function addSpotAt(point: [number, number] | null) {
    const id = nextSpotId(latest.current);
    if (!id) return setError(`That's ${MAX_SPOTS} areas, the most one quote takes. Describe anything else in an area you have.`);
    setError(null);
    const [spotLng, spotLat] = point ?? [lng ?? 0, lat ?? 0];
    change([...latest.current, { id, lng: spotLng, lat: spotLat, wants: "", services: [], noPhotos: false, ideas: [] }]);
    setOpenId(id);
  }

  async function removeSpot(id: string) {
    setError(null);
    // Its photos go with it, so a new area that takes its number starts empty.
    for (const p of photos.filter((p) => photoAreas[p.path] === id)) await removeIntakePhoto({ token, path: p.path }).catch(() => null);
    setPhotos((all) => all.filter((p) => photoAreas[p.path] !== id));
    change(latest.current.filter((s) => s.id !== id));
    if (openId === id) setOpenId(null);
  }

  const update = (id: string, patch: Partial<PhotoQuoteSpot>, now = true) => change(latest.current.map((s) => (s.id === id ? { ...s, ...patch } : s)), now);

  function problem(): string | null {
    if (spots.length === 0) return "Tap the map where you'd like work done, or add an area.";
    for (const [i, s] of spots.entries()) {
      if (!s.wants.trim() && s.services.length === 0) return `Say what you'd like done in area ${i + 1}.`;
      const has = photos.some((p) => photoAreas[p.path] === s.id);
      if (!has && !s.noPhotos) return `Add a photo of area ${i + 1}, or tick "I can't take photos".`;
    }
    return null;
  }

  function send() {
    const wrong = problem();
    if (wrong) return setError(wrong);
    setError(null);
    start(async () => {
      if (typing.current) clearTimeout(typing.current);
      const result = await submitEvaluationIntake({ token, answers: answersOf(latest.current), together: false }).catch(() => null);
      if (!result) return setError("Couldn't send it. Check your signal and try again: nothing you've added is lost.");
      if (!result.ok) return setError(result.error);
      setSentAt(result.submittedAt);
      setEditing(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  if (sentAt && !editing) {
    return (
      <div className="flex flex-col items-center gap-4 py-6 text-center">
        <CheckCircle2 className="h-12 w-12 text-primary" />
        <h2 className="text-xl font-semibold">Thanks, we&apos;ve got it</h2>
        <p className="text-muted-foreground">
          We&apos;ll price your {spots.length === 1 ? "area" : `${spots.length} areas`} from what you sent and get your quote to you. If
          anything needs a closer look, we&apos;ll let you know and you can pick a time for a quick visit.
        </p>
        {businessPhone && <p className="text-sm text-muted-foreground">Questions? Call or text {businessPhone}.</p>}
        <Button type="button" variant="outline" className="h-12" onClick={() => setEditing(true)}>
          Change something
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-28">
      <p className="text-sm text-muted-foreground">{greeting}</p>

      <div className="flex gap-2.5 rounded-xl border-2 border-primary/30 bg-primary/5 p-3 text-sm">
        <Wifi className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <p>
          <span className="font-semibold">This works best on good Wi-Fi or a strong signal.</span> Photos are large. If you can&apos;t
          take photos, that&apos;s fine: tick &ldquo;I can&apos;t take photos&rdquo; and we&apos;ll do our best from the satellite view.
        </p>
      </div>

      <ol className="flex flex-col gap-1 text-sm">
        <li>
          <span className="font-semibold">1.</span> Tap the map where you want work done. Each tap is an area.
        </li>
        <li>
          <span className="font-semibold">2.</span> Tell us what you&apos;d like done there.
        </li>
        <li>
          <span className="font-semibold">3.</span> Add a few photos of it.
        </li>
      </ol>

      {view && isMapboxConfigured ? (
        <SpotMap view={view} parcel={layout?.parcel ?? null} spots={spots} openId={openId} onTap={addSpotAt} onPick={setOpenId} disabled={pending} />
      ) : (
        <p className="rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">
          We couldn&apos;t load the map just now. Add your areas below and describe where each one is.
        </p>
      )}

      {spots.length < MAX_SPOTS && (
        <Button type="button" variant="outline" className="h-12" disabled={pending} onClick={() => addSpotAt(view ? view.center : null)}>
          <Plus className="mr-1.5 h-4 w-4" /> {spots.length === 0 ? "Add an area without the map" : "Add another area"}
        </Button>
      )}

      {spots.map((spot, i) => (
        <SpotCard
          key={spot.id}
          token={token}
          number={i + 1}
          spot={spot}
          open={openId === spot.id}
          onOpen={() => setOpenId(openId === spot.id ? null : spot.id)}
          photos={photos.filter((p) => photoAreas[p.path] === spot.id)}
          onPhoto={(p) => {
            setPhotos((all) => [...all, p]);
            setPhotoAreas((a) => ({ ...a, [p.path]: spot.id }));
          }}
          onRemovePhoto={(path) => setPhotos((all) => all.filter((p) => p.path !== path))}
          onChange={(patch, now) => update(spot.id, patch, now)}
          onRemove={() => void removeSpot(spot.id)}
          beforeUpload={save}
          disabled={pending}
        />
      ))}

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex w-full max-w-lg flex-col gap-1.5">
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="button" className="h-12 w-full text-base" disabled={pending} onClick={send}>
            {pending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending…
              </>
            ) : sentAt ? (
              "Send the changes"
            ) : (
              "Send it in"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Their property from above, with a numbered pin on each area. Tapping the picture adds one. */
function SpotMap({
  view,
  parcel,
  spots,
  openId,
  onTap,
  onPick,
  disabled,
}: {
  view: PictureView;
  parcel: [number, number][] | null;
  spots: PhotoQuoteSpot[];
  openId: string | null;
  onTap: (point: [number, number]) => void;
  onPick: (id: string) => void;
  disabled: boolean;
}) {
  const svg = useRef<SVGSVGElement>(null);
  function tap(event: React.MouseEvent<SVGSVGElement>) {
    if (disabled || !svg.current) return;
    const box = svg.current.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * view.width;
    const y = ((event.clientY - box.top) / box.height) * view.height;
    onTap(pictureToGround(view, [x, y]));
  }

  return (
    <figure className="flex flex-col gap-1.5">
      <div className="relative overflow-hidden rounded-xl border border-border bg-muted" style={{ aspectRatio: `${view.width} / ${view.height}` }}>
        {/* A static Mapbox photo: next/image has nothing to optimise. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={satelliteUrl(view, publicEnv.mapboxToken)} alt="Your property from above" className="absolute inset-0 h-full w-full object-cover" />
        <svg
          ref={svg}
          viewBox={`0 0 ${view.width} ${view.height}`}
          className="absolute inset-0 h-full w-full cursor-crosshair touch-manipulation"
          role="img"
          aria-label="Your property from above. Tap where you want work done."
          onClick={tap}
        >
          {parcel && <path d={pathOf(parcel)} fill="none" stroke="white" strokeWidth={2.5} strokeDasharray="7 5" pointerEvents="none" />}
          {spots.map((spot, i) => {
            const [x, y] = groundToPicture(view, [spot.lng, spot.lat]);
            const open = spot.id === openId;
            return (
              <g
                key={spot.id}
                transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`}
                className="cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onPick(spot.id);
                }}
              >
                {/* A big invisible ring, so a thumb finds the pin. */}
                <circle r={30} fill="transparent" />
                <circle r={open ? 20 : 17} fill={open ? "#16a34a" : "#ffffff"} stroke={open ? "#ffffff" : "#16a34a"} strokeWidth={4} />
                <text textAnchor="middle" dy="0.35em" className={cn("text-[18px] font-bold", open ? "fill-white" : "fill-green-700")}>
                  {i + 1}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-muted-foreground">
        <span>
          <MapPin className="mr-1 inline h-3.5 w-3.5" />
          Tap where you want work done. Tap a number to open that area.
        </span>
        <span className="text-[10px] opacity-70">{MAP_CREDIT}</span>
      </figcaption>
    </figure>
  );
}

/** One area: what they want done, its photos, and the ideas read off them. */
function SpotCard({
  token,
  number,
  spot,
  open,
  onOpen,
  photos,
  onPhoto,
  onRemovePhoto,
  onChange,
  onRemove,
  beforeUpload,
  disabled,
}: {
  token: string;
  number: number;
  spot: PhotoQuoteSpot;
  open: boolean;
  onOpen: () => void;
  photos: Photo[];
  onPhoto: (photo: Photo) => void;
  onRemovePhoto: (path: string) => void;
  onChange: (patch: Partial<PhotoQuoteSpot>, now?: boolean) => void;
  onRemove: () => void;
  /** Saves the areas, so the server knows this one before its first photo lands. */
  beforeUpload: () => Promise<unknown>;
  disabled: boolean;
}) {
  const library = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const waiting = useWaiting(`intake:${token}`).filter((item) => item.kind === "intake-photo" && item.args.area === spot.id);
  const room = PHOTOS_PER_AREA - photos.length - waiting.length;
  const done = (spot.wants.trim() || spot.services.length > 0) && (photos.length > 0 || waiting.length > 0 || spot.noPhotos);

  // Ideas from its photos, once, after the first ones are in. Quietly
  // nothing when the AI isn't set up or can't help.
  async function askForIdeas() {
    if (spot.ideas.length > 0) return;
    setThinking(true);
    const { ideas } = await suggestSpotIdeas({ token, spotId: spot.id }).catch(() => ({ ideas: [] as PhotoQuoteSpot["ideas"] }));
    setThinking(false);
    if (ideas.length > 0) onChange({ ideas });
  }

  async function add(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setBusy(true);
    let added = 0;
    try {
      await beforeUpload();
      for (const file of Array.from(files).slice(0, Math.max(0, room))) {
        const small = await shrinkImage(file, 1600, 0.8).catch(() => file);
        if (isHeic(small)) {
          setError("This phone saved that photo in a format we can't open. Use Take a photo instead.");
          break;
        }
        // Some phones hand over a photo with no type at all; its name says what it is.
        const type = small.type || (/\.png$/i.test(small.name) ? "image/png" : /\.webp$/i.test(small.name) ? "image/webp" : "image/jpeg");
        // Straight to storage; with no signal, kept on the phone and sent by itself later.
        const sent = await sendOrKeep({ kind: "intake-photo", scope: `intake:${token}`, label: `Photo of area ${number}`, blob: small, type, args: { token, area: spot.id } });
        if (sent.status === "refused") {
          setError(sent.message);
          break;
        }
        if (sent.status === "kept") continue;
        onPhoto({ path: String(sent.result.path), url: String(sent.result.url) });
        added++;
      }
      if (spot.noPhotos && added > 0) onChange({ noPhotos: false });
    } catch {
      setError("Couldn't add that photo. Check your signal and try again.");
    } finally {
      setBusy(false);
      if (library.current) library.current.value = "";
      if (camera.current) camera.current.value = "";
    }
    if (added > 0) void askForIdeas();
  }

  async function remove(path: string) {
    setError(null);
    const result = await removeIntakePhoto({ token, path }).catch(() => null);
    if (!result?.ok) return setError(result && !result.ok ? result.error : "Couldn't remove that photo just now.");
    onRemovePhoto(path);
  }

  const summary = spot.wants.trim() || spot.services.map((v) => SERVICE_CHIPS.find((o) => o.value === v)?.label ?? v).join(", ");

  return (
    <section className={cn("rounded-2xl border bg-card", open ? "border-primary/60 shadow-sm" : "border-border")}>
      <button type="button" onClick={onOpen} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold", done ? "bg-primary text-primary-foreground" : "border-2 border-primary text-primary")}>
          {done ? <CheckCircle2 className="h-5 w-5" /> : number}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Area {number}</span>
          <span className="block truncate text-sm text-muted-foreground">{summary || "Tap to tell us about it"}</span>
        </span>
        {photos.length > 0 && <span className="shrink-0 text-xs text-muted-foreground">{photos.length} photo{photos.length === 1 ? "" : "s"}</span>}
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t border-border px-4 pb-4 pt-3">
          <div className="flex flex-col gap-2">
            <label htmlFor={`wants-${spot.id}`} className="font-semibold">
              What do you want done here?
            </label>
            <Textarea
              id={`wants-${spot.id}`}
              value={spot.wants}
              maxLength={600}
              rows={3}
              className="text-base"
              placeholder="For example: fresh mulch in the front beds and pull the old bushes by the steps"
              disabled={disabled}
              onChange={(e) => onChange({ wants: e.target.value }, false)}
            />
            <div className="flex flex-wrap gap-1.5">
              {SERVICE_CHIPS.map((o) => {
                const on = spot.services.includes(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={on}
                    disabled={disabled}
                    onClick={() => onChange({ services: on ? spot.services.filter((v) => v !== o.value) : [...spot.services, o.value] })}
                    className={cn("min-h-10 rounded-full border px-3 text-sm", on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent")}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="font-semibold">Add photos of this area</p>
            <p className="-mt-1 text-sm text-muted-foreground">Up to {PHOTOS_PER_AREA}, from a couple of angles. Stand back far enough to show the whole area.</p>
            {(photos.length > 0 || waiting.length > 0 || busy) && (
              <div className="grid grid-cols-3 gap-2">
                {waiting.map((item) => (
                  <div key={item.id} className="relative aspect-square overflow-hidden rounded-lg bg-muted">
                    {item.preview && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.preview} alt="" className="h-full w-full object-cover opacity-80" />
                    )}
                    <span className="absolute inset-x-1 bottom-1 flex items-center justify-center gap-1 rounded bg-black/60 px-1 py-0.5 text-[10px] font-medium text-white">
                      <CloudOff className="h-3 w-3" /> Waiting for signal
                    </span>
                    <button
                      type="button"
                      aria-label="Remove this photo"
                      onClick={() => void removeItem(item.id)}
                      className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                {photos.map((p) => (
                  <div key={p.path} className="relative aspect-square overflow-hidden rounded-lg bg-muted">
                    {/* Signed links to a private bucket, so a plain img rather than the image optimiser. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt="" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      aria-label="Remove this photo"
                      disabled={disabled || busy}
                      onClick={() => void remove(p.path)}
                      className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                {busy && (
                  <div className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-sm text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin" />
                    Uploading
                  </div>
                )}
              </div>
            )}
            {room > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" className="h-12" disabled={disabled || busy} onClick={() => camera.current?.click()}>
                  <Camera className="mr-1.5 h-4 w-4" /> Take a photo
                </Button>
                <Button type="button" variant="outline" className="h-12" disabled={disabled || busy} onClick={() => library.current?.click()}>
                  <ImagePlus className="mr-1.5 h-4 w-4" /> Choose photos
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">That&apos;s {PHOTOS_PER_AREA} photos of this area, plenty to go on.</p>
            )}
            <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void add(e.target.files)} />
            <input ref={library} type="file" accept="image/*" multiple hidden onChange={(e) => void add(e.target.files)} />
            {photos.length === 0 && waiting.length === 0 && (
              <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                <input type="checkbox" className="h-5 w-5 shrink-0" checked={spot.noPhotos} disabled={disabled} onChange={(e) => onChange({ noPhotos: e.target.checked })} />
                <Satellite className="h-4 w-4 shrink-0 text-muted-foreground" />
                I can&apos;t take photos. Use the satellite view instead.
              </label>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          {(thinking || spot.ideas.length > 0) && (
            <div className="flex flex-col gap-2 rounded-xl bg-muted/50 p-3">
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <Sparkles className="h-4 w-4 text-primary" /> Ideas for this area
              </p>
              {thinking ? (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Looking at your photos…
                </p>
              ) : (
                <>
                  <p className="-mt-1 text-xs text-muted-foreground">From your photos. Tick any you&apos;d be interested in and we&apos;ll include a price.</p>
                  {spot.ideas.map((idea) => (
                    <label key={idea.text} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg bg-background px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-5 w-5 shrink-0"
                        checked={idea.interested}
                        disabled={disabled}
                        onChange={(e) => onChange({ ideas: spot.ideas.map((i) => (i.text === idea.text ? { ...i, interested: e.target.checked } : i)) })}
                      />
                      <span className="flex-1">{idea.text}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">I&apos;d be interested</span>
                    </label>
                  ))}
                </>
              )}
            </div>
          )}

          <button type="button" onClick={onRemove} disabled={disabled} className="flex min-h-11 items-center gap-1.5 self-start text-sm text-muted-foreground underline">
            <Trash2 className="h-4 w-4" /> Remove this area
          </button>
        </div>
      )}
    </section>
  );
}
