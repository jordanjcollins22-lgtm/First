import type { Metadata } from "next";
import "../globals.css";

/**
 * The advertiser's own root layout, outside the app shell.
 *
 * A local business clicking a link we sent them is not staff, and the staff
 * nav on their screen is both confusing and a small leak of how we work.
 *
 * The stylesheet is imported here and not inherited. A root layout outside
 * the (app) group inherits nothing from it, which this page found out the
 * hard way: it shipped with no CSS at all, so a prospective advertiser
 * opening the link we had just texted them got serif body text and a raw
 * "Choose File" button. Every route group that owns an <html> owns its own
 * stylesheet import.
 */
export const metadata: Metadata = {
  title: "Advertise on our flyer",
  description: "Put your advert in front of local homes.",
};

export const viewport = {
  themeColor: "#2f6d3c",
  width: "device-width",
  initialScale: 1,
  // Zoom left available: somebody checking their own artwork on a phone
  // should be able to make it bigger.
  maximumScale: 5,
  userScalable: true,
};

export default function FlyerLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-foreground">{children}</body>
    </html>
  );
}
