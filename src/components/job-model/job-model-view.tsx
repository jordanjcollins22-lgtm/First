"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Check, Loader2, Pause, Play, Plus, Sparkles, StepBack, StepForward, Trash2, Video, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { saveJobModel, suggestPlantsFromPhotos } from "@/lib/actions/job-model-actions";
import {
  applyStepEdits,
  areaAt,
  bearingBetween,
  cameraFor,
  clampSize,
  defaultSteps,
  modelBounds,
  moveStep,
  placeUnplaced,
  plantCounts,
  sayMinutes,
  stepEditsOf,
  totalMinutes,
  PLANT_COLOR,
  PLANT_SIZE_FT,
  PLANT_STATUSES,
  PLANT_STATUS_LABEL,
  type LngLat,
  type ModelArea,
  type ModelPlant,
  type PlantSuggestion,
  type StepEdit,
  type StoredJobModel,
} from "@/lib/job-model";
import { JobModelMap, type Camera } from "./job-model-map";

export interface JobModelViewProps {
  jobId: string;
  areas: ModelArea[];
  house: LngLat[] | null;
  pin: LngLat | null;
  defaultTruck: LngLat | null;
  stored: StoredJobModel;
  /** Saving works (the table is there and this is a real job). */
  canSave: boolean;
  /** Whoever runs jobs: may change the model. The crew only look. */
  canEdit: boolean;
  photos: { url: string; areaId: string | null }[];
  /** Why saving doesn't work, when it doesn't. */
  saveNote?: string | null;
}

const WALK_SECONDS = 6;

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `p${Date.now()}${Math.round(Math.random() * 1e6)}`;
}

function isVideoFile(url: string): boolean {
  return /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url) || url.startsWith("blob:");
}

export function JobModelView({ jobId, areas, house, pin, defaultTruck, stored, canSave, canEdit, photos, saveNote }: JobModelViewProps) {
  const [plants, setPlants] = useState<ModelPlant[]>(() => placeUnplaced(stored.plants, areas));
  const [edits, setEdits] = useState<StepEdit[]>(stored.steps);
  const [truck, setTruck] = useState<LngLat | null>(stored.truck ?? defaultTruck);
  const [videoUrl, setVideoUrl] = useState<string | null>(stored.videoUrl);
  const [editing, setEditing] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [walking, setWalking] = useState(false);
  const [flyTo, setFlyTo] = useState<(Camera & { key: number; duration?: number }) | null>(null);
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [suggesting, startSuggest] = useTransition();
  const [suggestions, setSuggestions] = useState<(PlantSuggestion & { pick: boolean })[] | null>(null);
  const [uploading, setUploading] = useState(false);

  const defaults = useMemo(() => defaultSteps(areas, plants, truck), [areas, plants, truck]);
  const steps = useMemo(() => applyStepEdits(defaults, edits), [defaults, edits]);
  const counts = plantCounts(plants);
  const bounds = useMemo(() => modelBounds(areas, plants, truck), [areas, plants, truck]);
  const center: LngLat = bounds ? [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2] : (pin ?? defaultTruck ?? [-76.348, 39.536]);
  const lookBearing = truck ? bearingBetween(truck, center) : 0;
  const areaName = new Map(areas.map((a, i) => [a.id, `${i + 1}. ${a.name}`]));

  const changed = () => {
    setDirty(true);
    setNote(null);
  };

  function goTo(index: number) {
    const cam = cameraFor(steps, index, lookBearing);
    setActive(index);
    if (cam) setFlyTo({ ...cam, key: Date.now() });
  }

  // The walk-through: one step every few seconds, the camera going along.
  useEffect(() => {
    if (!walking) return;
    const t = window.setTimeout(() => {
      const next = (active ?? -1) + 1;
      if (next >= steps.length) setWalking(false);
      else goTo(next);
    }, active == null ? 50 : WALK_SECONDS * 1000);
    return () => window.clearTimeout(t);
    // goTo reads the latest steps; the timer only restarts on a new step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walking, active]);

  function updatePlant(id: string, patch: Partial<ModelPlant>) {
    setPlants((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    changed();
  }

  function setSteps(next: typeof steps) {
    setEdits(stepEditsOf(next, defaults));
    changed();
  }

  function save() {
    startSave(async () => {
      const result = await saveJobModel(jobId, { plants, steps: edits, truck, videoUrl: videoUrl?.startsWith("blob:") ? null : videoUrl });
      if (result.ok) {
        setDirty(false);
        setNote("Saved");
      } else setNote(result.error);
    });
  }

  function suggest() {
    startSuggest(async () => {
      setNote(null);
      const result = await suggestPlantsFromPhotos(jobId);
      if (result.ok) setSuggestions(result.plants.map((p) => ({ ...p, pick: true })));
      else setNote(result.error);
    });
  }

  function addSuggestions() {
    const picked = (suggestions ?? []).filter((s) => s.pick);
    const added: ModelPlant[] = picked.map((s) => ({ id: newId(), name: s.name, status: s.status, heightFt: s.heightFt, spreadFt: s.spreadFt, areaId: s.areaId, at: null, ...(s.why ? { note: s.why } : {}) }));
    setPlants((list) => placeUnplaced([...list, ...added], areas));
    setSuggestions(null);
    setEditing(true);
    changed();
  }

  async function uploadVideo(file: File) {
    if (!canSave) {
      setVideoUrl(URL.createObjectURL(file));
      return;
    }
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
      const path = `${jobId}/model-video/${Date.now()}.${ext}`;
      const storage = createClient().storage.from("canvas-images");
      const { error } = await storage.upload(path, file, { contentType: file.type || "video/mp4", upsert: true });
      if (error) throw error;
      setVideoUrl(storage.getPublicUrl(path).data.publicUrl);
      changed();
    } catch {
      setNote("Couldn't upload the video. Paste a link to it instead.");
    } finally {
      setUploading(false);
    }
  }

  const selectedPlant = plants.find((p) => p.id === selected) ?? null;
  const activeStep = active != null ? steps[active] : null;

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
      {/* The model */}
      <div className="flex flex-col gap-2 lg:sticky lg:top-4">
        <div id="jm-model" className="relative h-[58vh] min-h-[360px] overflow-hidden rounded-xl border border-border bg-muted lg:h-[76vh]">
          <JobModelMap
            areas={areas}
            plants={plants}
            steps={steps}
            truck={truck}
            house={house}
            center={center}
            bounds={bounds}
            selectedPlantId={selected}
            activeStep={active}
            editing={editing}
            placing={placing}
            flyTo={flyTo}
            onMapClick={(at) => {
              const plant: ModelPlant = { id: newId(), name: "New plant", status: "new", heightFt: 3, spreadFt: 3, areaId: areaAt(at, areas), at };
              setPlants((list) => [...list, plant]);
              setSelected(plant.id);
              setPlacing(false);
              changed();
            }}
            onPlantMove={(id, at) => updatePlant(id, { at, areaId: areaAt(at, areas) ?? plants.find((p) => p.id === id)?.areaId ?? null })}
            onTruckMove={(at) => {
              setTruck(at);
              changed();
            }}
            onSelectPlant={setSelected}
            onSelectStep={(i) => {
              setWalking(false);
              goTo(i);
            }}
          />
          {activeStep && (
            <div className="absolute inset-x-2 bottom-2 rounded-xl bg-slate-950/85 p-3 text-white shadow-xl backdrop-blur sm:inset-x-auto sm:left-3 sm:max-w-sm">
              <div className="flex items-start gap-2">
                <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-yellow-400 px-1 text-sm font-bold text-black">{active! + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-snug">{activeStep.title}</p>
                  <p className="text-xs text-white/75">
                    {activeStep.areaId ? areaName.get(activeStep.areaId) : "Whole site"} · {sayMinutes(activeStep.minutes)}
                  </p>
                  {activeStep.tools.length > 0 && <p className="mt-1 text-xs text-white/90">Bring: {activeStep.tools.join(", ")}</p>}
                </div>
                <button type="button" aria-label="Close" className="text-white/70 hover:text-white" onClick={() => { setActive(null); setWalking(false); }}>
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Button size="sm" variant="secondary" disabled={active === 0} onClick={() => { setWalking(false); goTo(Math.max(0, active! - 1)); }} aria-label="Previous step">
                  <StepBack className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setWalking((w) => !w)} aria-label={walking ? "Pause" : "Play"}>
                  {walking ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </Button>
                <Button size="sm" variant="secondary" disabled={active === steps.length - 1} onClick={() => { setWalking(false); goTo(Math.min(steps.length - 1, active! + 1)); }} aria-label="Next step">
                  <StepForward className="h-4 w-4" />
                </Button>
                <span className="ml-auto text-xs text-white/70">
                  {active! + 1} of {steps.length}
                </span>
              </div>
            </div>
          )}
          {placing && <p className="absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-yellow-400 px-3 py-1 text-sm font-semibold text-black shadow">Tap where the plant goes</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            id="jm-walk"
            onClick={() => {
              setActive(null);
              setWalking(true);
            }}
            disabled={steps.length === 0}
          >
            <Play className="h-4 w-4" /> Walk me through it
          </Button>
          <span className="text-sm text-muted-foreground">
            {steps.length} steps · about {sayMinutes(totalMinutes(steps))} of crew time
          </span>
          {canEdit && (
            <div className="ml-auto flex items-center gap-2">
              {editing && dirty && (
                <Button onClick={save} disabled={saving || !canSave} title={saveNote ?? undefined}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
                </Button>
              )}
              <Button variant="outline" onClick={() => { setEditing((e) => !e); setPlacing(false); }}>
                {editing ? "Done editing" : "Edit"}
              </Button>
            </div>
          )}
        </div>
        {(note || (editing && dirty && saveNote)) && <p className="text-sm text-muted-foreground">{note ?? saveNote}</p>}
      </div>

      {/* Beside it */}
      <div className="flex flex-col gap-4">
        <section id="jm-plants" className="rounded-xl border border-border bg-card p-3">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">Plants</h2>
            <div className="ml-auto flex gap-3 text-xs">
              {PLANT_STATUSES.map((s) => (
                <span key={s} className="flex items-center gap-1">
                  <span className="relative inline-block h-3 w-3 rounded-full" style={{ background: PLANT_COLOR[s] }}>
                    {s === "remove" && <X className="absolute inset-0 h-3 w-3 text-white" strokeWidth={4} />}
                  </span>
                  {PLANT_STATUS_LABEL[s]} {counts[s]}
                </span>
              ))}
            </div>
          </div>
          {editing && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant={placing ? "default" : "outline"} onClick={() => setPlacing((p) => !p)}>
                <Plus className="h-4 w-4" /> {placing ? "Tap the map…" : "Add a plant"}
              </Button>
              {photos.length > 0 && (
                <Button size="sm" variant="outline" onClick={suggest} disabled={suggesting}>
                  {suggesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Suggest from photos
                </Button>
              )}
            </div>
          )}

          {suggestions && (
            <div className="mt-3 rounded-lg border border-primary/40 bg-primary/5 p-2">
              <p className="text-sm font-medium">From the photos: tick the right ones</p>
              <ul className="mt-1 flex flex-col gap-1">
                {suggestions.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={s.pick}
                      onChange={(e) => setSuggestions((list) => list!.map((x, j) => (j === i ? { ...x, pick: e.target.checked } : x)))}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{s.name}</span>{" "}
                      <span style={{ color: PLANT_COLOR[s.status] }} className="font-semibold">
                        {PLANT_STATUS_LABEL[s.status]}
                      </span>{" "}
                      <span className="text-muted-foreground">
                        · {s.heightFt}×{s.spreadFt} ft · {s.areaId ? areaName.get(s.areaId) : "bed unknown"}
                      </span>
                      {s.why && <span className="block text-xs text-muted-foreground">{s.why}</span>}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={addSuggestions} disabled={!suggestions.some((s) => s.pick)}>
                  Add {suggestions.filter((s) => s.pick).length} to the model
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSuggestions(null)}>
                  Discard
                </Button>
              </div>
            </div>
          )}

          <ul className="mt-2 flex max-h-[40vh] flex-col divide-y divide-border overflow-y-auto">
            {plants.length === 0 && <li className="py-2 text-sm text-muted-foreground">No plants on the model yet.</li>}
            {plants.map((p) => {
              const isSelected = p.id === selected;
              return (
                <li key={p.id} className={`py-2 ${isSelected ? "bg-yellow-50 dark:bg-yellow-950/30" : ""}`}>
                  <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setSelected(isSelected ? null : p.id)}>
                    <span className="relative h-3.5 w-3.5 shrink-0 rounded-full" style={{ background: PLANT_COLOR[p.status] }}>
                      {p.status === "remove" && <X className="absolute inset-0 h-3.5 w-3.5 text-white" strokeWidth={4} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {p.heightFt}′ h × {p.spreadFt}′ w{p.areaId ? ` · ${areaName.get(p.areaId)?.split(". ")[0] ?? ""}` : ""}
                      {!p.at && " · not placed"}
                    </span>
                  </button>
                  {editing && isSelected && (
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <label className="col-span-2 flex flex-col gap-0.5">
                        Name
                        <Input value={p.name} onChange={(e) => updatePlant(p.id, { name: e.target.value.slice(0, 80) })} className="h-8" />
                      </label>
                      <div className="col-span-2 flex gap-1">
                        {PLANT_STATUSES.map((s) => (
                          <button
                            key={s}
                            type="button"
                            className={`flex-1 rounded-md border px-2 py-1 font-medium ${p.status === s ? "text-white" : ""}`}
                            style={p.status === s ? { background: PLANT_COLOR[s], borderColor: PLANT_COLOR[s] } : { borderColor: PLANT_COLOR[s], color: PLANT_COLOR[s] }}
                            onClick={() => updatePlant(p.id, { status: s })}
                          >
                            {PLANT_STATUS_LABEL[s]}
                          </button>
                        ))}
                      </div>
                      <label className="flex flex-col gap-0.5">
                        Height (ft)
                        <Input type="number" min={PLANT_SIZE_FT.min} step={0.5} value={p.heightFt} onChange={(e) => updatePlant(p.id, { heightFt: clampSize(e.target.value, PLANT_SIZE_FT.maxHeight, p.heightFt) })} className="h-8" />
                      </label>
                      <label className="flex flex-col gap-0.5">
                        Spread (ft)
                        <Input type="number" min={PLANT_SIZE_FT.min} step={0.5} value={p.spreadFt} onChange={(e) => updatePlant(p.id, { spreadFt: clampSize(e.target.value, PLANT_SIZE_FT.maxSpread, p.spreadFt) })} className="h-8" />
                      </label>
                      <div className="col-span-2 flex items-center justify-between">
                        <span className="text-muted-foreground">{p.at ? "Drag its dot on the map to move it" : "Not placed: put it in a bed"}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => {
                            setPlants((list) => list.filter((x) => x.id !== p.id));
                            setSelected(null);
                            changed();
                          }}
                        >
                          <Trash2 className="h-4 w-4" /> Delete
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {selectedPlant && !editing && selectedPlant.note && <p className="mt-1 text-xs text-muted-foreground">{selectedPlant.note}</p>}
        </section>

        <section id="jm-steps" className="rounded-xl border border-border bg-card p-3">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">Order of work</h2>
            {editing && edits.length > 0 && (
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => { setEdits([]); changed(); }}>
                Reset to default
              </Button>
            )}
          </div>
          {editing && <p className="text-xs text-muted-foreground">Drag the truck on the map to where it parks; the order follows it.</p>}
          <ol className="mt-2 flex flex-col gap-1">
            {steps.map((s, i) => (
              <li key={s.id} className={`rounded-lg border p-2 ${active === i ? "border-yellow-400 bg-yellow-50 dark:bg-yellow-950/30" : "border-transparent hover:bg-muted/60"}`}>
                <div className="flex items-start gap-2">
                  <button type="button" className="flex min-w-0 flex-1 items-start gap-2 text-left" onClick={() => { setWalking(false); goTo(i); }}>
                    <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-900 px-1 text-xs font-bold text-white">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium leading-snug">{s.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {s.areaId ? areaName.get(s.areaId) : "Whole site"} · {sayMinutes(s.minutes)}
                        {s.tools.length > 0 && ` · ${s.tools.join(", ")}`}
                      </span>
                    </span>
                  </button>
                  {editing && (
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <div className="flex">
                        <button type="button" aria-label="Move up" disabled={i === 0} className="rounded p-1 hover:bg-muted disabled:opacity-30" onClick={() => setSteps(moveStep(steps, i, i - 1))}>
                          <ArrowUp className="h-4 w-4" />
                        </button>
                        <button type="button" aria-label="Move down" disabled={i === steps.length - 1} className="rounded p-1 hover:bg-muted disabled:opacity-30" onClick={() => setSteps(moveStep(steps, i, i + 1))}>
                          <ArrowDown className="h-4 w-4" />
                        </button>
                      </div>
                      <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Input
                          type="number"
                          min={1}
                          value={s.minutes}
                          aria-label="Minutes"
                          className="h-7 w-16 px-1 text-xs"
                          onChange={(e) => {
                            const m = Math.round(Number(e.target.value));
                            if (m > 0 && m <= 600) setSteps(steps.map((x, j) => (j === i ? { ...x, minutes: m } : x)));
                          }}
                        />
                        min
                      </label>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>

        {(photos.length > 0 || videoUrl || editing) && (
          <section id="jm-media" className="rounded-xl border border-border bg-card p-3">
            <h2 className="font-semibold">Photos and video</h2>
            {photos.length > 0 && (
              <div className="mt-2 flex gap-2 overflow-x-auto">
                {photos.map((p) => (
                  <a key={p.url} href={p.url} target="_blank" rel="noreferrer" className="shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={p.areaId ? `Photo of ${areaName.get(p.areaId)}` : "Job photo"} className="h-20 w-20 rounded-lg object-cover" loading="lazy" />
                  </a>
                ))}
              </div>
            )}
            {videoUrl &&
              (isVideoFile(videoUrl) ? (
                <video src={videoUrl} controls playsInline className="mt-2 w-full rounded-lg bg-black" />
              ) : (
                <a href={videoUrl} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-2 text-sm font-medium text-primary underline">
                  <Video className="h-4 w-4" /> Walk-around video
                </a>
              ))}
            {editing && (
              <div className="mt-2 flex flex-col gap-2">
                <Input
                  placeholder="Link to a walk-around video"
                  defaultValue={videoUrl && !videoUrl.startsWith("blob:") ? videoUrl : ""}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v === (videoUrl ?? "")) return;
                    if (v && !/^https?:\/\//i.test(v)) return setNote("A video link starts with https://");
                    setVideoUrl(v || null);
                    changed();
                  }}
                />
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-primary">
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
                  {uploading ? "Uploading…" : "Or upload a video"}
                  <input type="file" accept="video/*" className="hidden" disabled={uploading} onChange={(e) => e.target.files?.[0] && uploadVideo(e.target.files[0])} />
                </label>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
