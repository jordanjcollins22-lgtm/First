"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { saveProposalAddon } from "@/lib/actions/proposal-actions";
import { CHRISTMAS_LIGHTS_KEY, CHRISTMAS_LIGHTS_NAME, DEFAULT_LIGHT_AREAS, addonLines, type ProposalAddon } from "@/lib/proposal-addons";
import { money } from "@/components/phone/parts";

type AreaRow = { name: string; price: string };

/** The area list the form opens with: what is on the proposal, or the default list unpriced. */
function startRows(current: ProposalAddon | null): AreaRow[] {
  if (current?.areas?.length) return current.areas.map((a) => ({ name: a.name, price: String(a.priceCents / 100) }));
  return DEFAULT_LIGHT_AREAS.map((name) => ({ name, price: "" }));
}

/**
 * The account manager's Christmas lights add-on for one proposal: a price
 * for each area the client can pick (roofline, front trees, bushes...),
 * whose lights and whether takedown is in it. The client ticks the areas
 * they want when they accept; it costs them nothing unless they tick one.
 * An area left without a price is not offered.
 */
export function AddonEditor({ jobId, addons }: { jobId: string; addons: ProposalAddon[] }) {
  const router = useRouter();
  const current = addons.find((a) => a.key === CHRISTMAS_LIGHTS_KEY) ?? null;
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<AreaRow[]>(() => startRows(current));
  const [lights, setLights] = useState<string>(current?.lights ?? "");
  const [takedown, setTakedown] = useState<string>(current?.takedown ?? "");
  const [note, setNote] = useState(current?.note ?? "");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, start] = useTransition();

  const setRow = (i: number, patch: Partial<AreaRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = (remove: boolean) =>
    start(async () => {
      const r = await saveProposalAddon(
        jobId,
        CHRISTMAS_LIGHTS_KEY,
        remove ? null : { name: CHRISTMAS_LIGHTS_NAME, price: "", areas: rows, decorate: "", lights, takedown, note }
      );
      if (!r.ok) {
        setMsg({ text: r.error, bad: true });
        return;
      }
      setMsg({ text: remove ? "Taken off the proposal." : "Saved. The client can tick the areas they want when they accept.", bad: false });
      if (remove) {
        setRows(startRows(null));
        setLights("");
        setTakedown("");
        setNote("");
      }
      setOpen(false);
      router.refresh();
    });

  if (!open) {
    return (
      <>
        {current && (
          <div className="vx-q">
            <b>
              {current.name} add-on · {current.areas ? `${current.areas.length} area${current.areas.length === 1 ? "" : "s"}` : money(current.priceCents / 100)}
            </b>
            {current.areas?.map((a) => (
              <div key={a.key} className="vx-sm">
                {a.name} · {money(a.priceCents / 100)}
              </div>
            ))}
            {addonLines(current).map((l) => (
              <div key={l} className="vx-sm">
                {l}
              </div>
            ))}
          </div>
        )}
        <button type="button" className="vx-cta vx-alt" onClick={() => setOpen(true)}>
          {current ? "Change Christmas lights option" : "Offer Christmas lights"}
        </button>
        {msg && <div className={`vx-note ${msg.bad ? "bad" : "ok"}`}>{msg.text}</div>}
      </>
    );
  }

  return (
    <div className="vx-q" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <b>Christmas lights option</b>
      <div className="vx-sm">
        Put a price on each area you can do at this house. The client ticks the areas they want when they accept and only pays for those.
        Leave an area&apos;s price empty and it is not offered.
      </div>
      {rows.map((row, i) => (
        <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            className="vx-field"
            style={{ flex: 2 }}
            aria-label={`Area ${i + 1}`}
            placeholder="Area, e.g. Roofline"
            value={row.name}
            onChange={(e) => setRow(i, { name: e.target.value })}
          />
          <input
            className="vx-field"
            style={{ flex: 1 }}
            inputMode="decimal"
            aria-label={`Price for ${row.name || `area ${i + 1}`} ($)`}
            placeholder="$"
            value={row.price}
            onChange={(e) => setRow(i, { price: e.target.value })}
          />
          <button
            type="button"
            className="vx-cta vx-alt"
            style={{ width: "auto", padding: "0 10px" }}
            aria-label={`Remove ${row.name || "this area"}`}
            onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="vx-cta vx-alt" onClick={() => setRows((rs) => [...rs, { name: "", price: "" }])}>
        Add an area
      </button>
      <label className="vx-sm">
        Whose lights
        <select className="vx-field" value={lights} onChange={(e) => setLights(e.target.value)}>
          <option value="">Don&apos;t say</option>
          <option value="ours">We supply the lights</option>
          <option value="theirs">We hang the client&apos;s lights</option>
        </select>
      </label>
      <label className="vx-sm">
        Takedown after the holidays
        <select className="vx-field" value={takedown} onChange={(e) => setTakedown(e.target.value)}>
          <option value="">Don&apos;t say</option>
          <option value="included">Included in the price</option>
          <option value="not_included">Not included</option>
        </select>
      </label>
      <label className="vx-sm">
        Anything else the client should know (optional)
        <input className="vx-field" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="vx-2b">
        <button type="button" className="vx-cta" disabled={busy} onClick={() => save(false)}>
          Save
        </button>
        <button type="button" className="vx-cta vx-alt" disabled={busy} onClick={() => (current ? save(true) : setOpen(false))}>
          {current ? "Take it off" : "Cancel"}
        </button>
      </div>
      {msg && <div className={`vx-note ${msg.bad ? "bad" : "ok"}`}>{msg.text}</div>}
    </div>
  );
}
