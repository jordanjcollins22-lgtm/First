import type { Metadata } from "next";
import "../globals.css";

/**
 * The offer page, outside the app shell.
 *
 * Opened from a campaign email on a phone by somebody with no account.
 * The stylesheet is imported here and not inherited: a root layout outside
 * the (app) group inherits nothing from it.
 */
export const metadata: Metadata = {
  title: "Your credit",
  description: "Book with your credit applied.",
  robots: { index: false, follow: false },
};

export const viewport = {
  themeColor: "#2f6d3c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default function OfferLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-background text-foreground">{children}</body>
    </html>
  );
}
