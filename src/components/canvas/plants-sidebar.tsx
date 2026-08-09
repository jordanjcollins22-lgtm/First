"use client";

import type { DragEvent } from "react";

import { PLANT_DRAG_MIME, PLANT_TYPES } from "./plant-types";

export function PlantsSidebar() {
  function handleDragStart(e: DragEvent<HTMLLIElement>, plantId: string) {
    e.dataTransfer.setData(PLANT_DRAG_MIME, plantId);
    e.dataTransfer.effectAllowed = "copy";
  }

  return (
    <aside className="w-full shrink-0 md:w-52">
      <div className="rounded-lg border border-border bg-card p-3">
        <h2 className="text-sm font-semibold">Plants</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Drag a plant onto the canvas to place it.
        </p>
        <ul className="mt-3 flex flex-col gap-1">
          {PLANT_TYPES.map((plant) => (
            <li
              key={plant.id}
              draggable
              onDragStart={(e) => handleDragStart(e, plant.id)}
              className="flex cursor-grab items-center gap-2 rounded-md border border-border bg-background px-2 py-2 text-sm select-none hover:bg-accent active:cursor-grabbing"
            >
              <span className="text-lg leading-none" aria-hidden>
                {plant.emoji}
              </span>
              {plant.label}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
