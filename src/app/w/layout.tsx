import type { Metadata } from "next";
import "../globals.css";

/**
 * What a scanned weed opens, outside the app shell.
 *
 * Whoever scanned it is holding a printed sheet — a homeowner in their own
 * garden as often as a crew member. There is no sign-in, because a sign-in
 * wall is how a QR code on a leaflet becomes a dead end, and there is
 * nothing on the page but a plant.
 *
 * The stylesheet is imported here and not inherited: a root layout outside
 * the (app) group inherits nothing from it.
 */
export const metadata: Metadata = {
  title: "Weed guide",
  description: "What this weed is, and what it looks like.",
};

export const viewport = {
  themeColor: "#2f6d3c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default function WeedLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-background text-foreground">{children}</body>
    </html>
  );
}
