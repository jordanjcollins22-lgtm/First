import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Subcontractor quote PDFs are uploaded through a server action.
      // Vercel caps request bodies at 4.5 MB, so stay under that.
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
