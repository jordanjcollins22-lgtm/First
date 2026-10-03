import type { Metadata } from "next";
import "../globals.css";

/**
 * The quick mow page, outside the app shell. Opened from a link in a post by
 * somebody with no account, so nothing on it but the address, the price and
 * the card.
 */
export const metadata: Metadata = {
  metadataBase: new URL("https://app.jslandscapingmd.com"),
  title: "Get your lawn mowed",
  description: "Your price in seconds. Pay for your first mow and we'll call to set your day.",
};

export const viewport = {
  themeColor: "#2f6d3c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default function MowLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-background text-foreground">{children}</body>
    </html>
  );
}
