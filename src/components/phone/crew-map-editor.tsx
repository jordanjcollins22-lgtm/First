"use client";

import { useState, useTransition } from "react";

import { LotPicker } from "@/components/intake/lot-picker";
import { saveCrewMap } from "@/lib/actions/crew-map-actions";
import {
  CREW_MAP_AREAS,
  type CrewMap,
  type CrewMapArea,
} from "@/lib/crew-map-areas";
import type { LotData } from "@/lib/lot-map";

/** Tap the parts of the yard the crew works on; Save puts it on the crew map. */
export function CrewMapEditor({
  jobId,
  lot,
  start,
  crewLink,
}: {
  jobId: string;
  lot: LotData;
  start: CrewMap | null;
  crewLink: string;
}) {
  const [areas, setAreas] = useState<CrewMapArea[]>(start?.areas ?? []);
  const [turn, setTurn] = useState(start?.turn ?? 0);
  const [busy, run] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const toggle = (k: string) => {
    setNote(null);
    setAreas((a) =>
      a.includes(k as CrewMapArea)
        ? a.filter((x) => x !== k)
        : [...a, k as CrewMapArea],
    );
  };
  const save = () =>
    run(async () => {
      const res = await saveCrewMap(jobId, { areas, turn });
      setNote(
        res.ok
          ? { ok: true, text: "Saved. The crew map shows it now." }
          : { ok: false, text: res.error },
      );
    });

  return (
    <div className="flex flex-col gap-3">
      <LotPicker
        lot={lot}
        picked={areas}
        onToggle={toggle}
        initialTurn={turn}
        onTurn={(t) => {
          setTurn(t);
          setNote(null);
        }}
        caption="Tap a part of the yard."
      />
      <div className="flex flex-wrap gap-2">
        {CREW_MAP_AREAS.map((a) => (
          <button
            key={a.key}
            type="button"
            aria-pressed={areas.includes(a.key)}
            onClick={() => toggle(a.key)}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${areas.includes(a.key) ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
          >
            {areas.includes(a.key) ? "✓ " : "+ "}
            {a.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy || areas.length === 0}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save crew map"}
        </button>
        <a
          href={crewLink}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-primary"
        >
          Open the crew map
        </a>
      </div>
      {note && (
        <p
          className={`text-sm ${note.ok ? "text-primary" : "text-destructive"}`}
        >
          {note.text}
        </p>
      )}
    </div>
  );
}
