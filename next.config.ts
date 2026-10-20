import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Store designs can be full-size print images (see MAX_DESIGN_BYTES in merch-actions.ts).
    serverActions: { bodySizeLimit: "4.5mb" },
  },
  // Native PNG renderer for print files; keep it out of the bundle.
  serverExternalPackages: ["@resvg/resvg-js"],
};

export default nextConfig;
