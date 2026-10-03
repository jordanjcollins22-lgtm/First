import type { Metadata } from "next";
import "../globals.css";

/**
 * The public landing page's own root layout: no staff navigation, the same
 * shape as /book and /salt, because whoever opens it is a client or about
 * to be one.
 */
export const metadata: Metadata = {
  metadataBase: new URL("https://app.jslandscapingmd.com"),
  title: "JS Landscaping MD · Free yard evaluation",
  description: "Lawn care, landscaping and cleanups in Harford County. Book a free evaluation in a minute.",
};

export const viewport = {
  themeColor: "#2f6d3c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default function StartLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col" style={{ background: "#ffffff" }}>{children}</body>
    </html>
  );
}
