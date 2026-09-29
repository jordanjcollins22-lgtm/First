"use client";

import { useTransition } from "react";
import Link from "next/link";

import { closeDemo, openDemo } from "@/lib/actions/demo-actions";

/**
 * Across the top of every page while a demo is open: who it is showing, a
 * way to swap to somebody else, and a way out.
 */
export function DemoBanner({
  viewing,
  team,
}: {
  viewing: { id: string; name: string; roles: string[] };
  team: { id: string; name: string; roles: string[] }[];
}) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-sky-600 px-4 py-1.5 text-sm font-medium text-white">
      <span>
        Demo as {viewing.name}
        {viewing.roles.length > 0 && <span className="capitalize opacity-90"> ({viewing.roles.join(", ")})</span>}. Nothing is saved or sent.
      </span>
      <label className="flex items-center gap-1">
        <span className="sr-only">Swap to</span>
        <select
          value={viewing.id}
          disabled={pending}
          onChange={(e) => {
            const id = e.target.value;
            start(() => openDemo(id));
          }}
          className="h-7 rounded border border-white/40 bg-sky-700 px-1.5 text-xs text-white"
        >
          {team.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.roles.length > 0 ? ` (${p.roles.join(", ")})` : ""}
            </option>
          ))}
        </select>
      </label>
      <Link href="/admin/demo" className="underline underline-offset-2 hover:no-underline">
        All roles
      </Link>
      <button type="button" disabled={pending} onClick={() => start(() => closeDemo())} className="underline underline-offset-2 hover:no-underline">
        Close demo
      </button>
    </div>
  );
}
