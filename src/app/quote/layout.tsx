import type { Metadata } from "next";
import "../globals.css";

/**
 * A subcontractor's price page, outside the app shell.
 *
 * Opened from a text by somebody with no account: what we want done, the
 * photos, and a box for their number. Nothing else.
 */
export const metadata: Metadata = {
  metadataBase: new URL("https://app.jslandscapingmd.com"),
  title: "Price request",
  description: "What we need done, and where to put your price.",
  robots: { index: false, follow: false },
};

export const viewport = {
  themeColor: "#2f6d3c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default function QuoteLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-background text-foreground">{children}</body>
    </html>
  );
}
