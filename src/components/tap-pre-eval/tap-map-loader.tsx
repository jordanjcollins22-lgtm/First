"use client";

import dynamic from "next/dynamic";

// mapbox-gl touches `window` when it is imported, so the map never renders on
// the server. next/dynamic's ssr: false only works from a client component.
export const TapMapLoader = dynamic(() => import("./tap-map").then((m) => m.TapMap), { ssr: false });
