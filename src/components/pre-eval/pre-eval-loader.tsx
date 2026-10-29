"use client";

import dynamic from "next/dynamic";

// mapbox-gl touches `window` at import time; see job-workspace-loader.tsx.
export const PreEvalLoader = dynamic(
  () => import("./pre-eval-form").then((m) => m.PreEvalForm),
  { ssr: false }
);
