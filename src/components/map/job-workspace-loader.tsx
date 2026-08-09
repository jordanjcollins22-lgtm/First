"use client";

import dynamic from "next/dynamic";

// mapbox-gl touches `window` at import time, so the workspace must never
// be rendered during SSR. next/dynamic's `ssr: false` option can only be
// used from a Client Component, hence this thin wrapper around the real
// (also client) JobWorkspace component.
export const JobWorkspaceClient = dynamic(
  () => import("./job-workspace").then((m) => m.JobWorkspace),
  { ssr: false }
);
