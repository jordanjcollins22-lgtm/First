import type { Metadata } from "next";
import "../globals.css";

/**
 * This route's own root layout, outside the (app) group. Without one the
 * page renders with no stylesheet at all, because globals.css can only come
 * in through a layout. No staff navigation: whoever opens it has no login.
 */
export const metadata: Metadata = {
  metadataBase: new URL("https://app.jslandscapingmd.com"),
  title: "JS Landscaping",
};

export const viewport = {
  themeColor: "#0f766e",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-foreground">{children}</body>
    </html>
  );
}
