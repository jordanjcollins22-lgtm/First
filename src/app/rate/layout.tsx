import type { Metadata } from "next";
import "../globals.css";

/**
 * The client's own root layout, outside the (app) group, as /tip and /done
 * have: without it the page renders with no stylesheet. No staff navigation,
 * because the person holding this link is a client.
 */
export const metadata: Metadata = {
  metadataBase: new URL("https://app.jslandscapingmd.com"),
  title: "How did we do?",
  description: "Rate your project",
  robots: { index: false, follow: false },
};

export const viewport = {
  themeColor: "#2f6d3c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default function RateLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background">{children}</body>
    </html>
  );
}
