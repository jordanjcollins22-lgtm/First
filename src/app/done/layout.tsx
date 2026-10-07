import type { Metadata } from "next";
import "../globals.css";

/**
 * The client's before and afters, outside the app shell.
 *
 * Opened from an email on a phone by somebody with no account: the photos,
 * and a yes or a "not quite". The stylesheet is imported here and not
 * inherited, because a root layout outside the (app) group inherits nothing.
 */
export const metadata: Metadata = {
  metadataBase: new URL("https://app.jslandscapingmd.com"),
  title: "Your before and after",
  description: "Your finished project, area by area.",
  robots: { index: false, follow: false },
};

export const viewport = {
  themeColor: "#2f6d3c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default function DoneLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-background text-foreground">{children}</body>
    </html>
  );
}
