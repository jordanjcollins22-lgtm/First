import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Bank statement CSV uploads on /accounting go through a Server Action.
    serverActions: { bodySizeLimit: "5mb" },
  },
};

export default nextConfig;
