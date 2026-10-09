import type { Metadata } from "next";
import "../globals.css";

/**
 * The business's public website, outside the app shell: somebody who found
 * the business sees the site, never the app's header or menu.
 */
export const metadata: Metadata = {
  metadataBase: new URL("https://app.jslandscapingmd.com"),
  title: "JS Landscaping",
  description: "Lawn care, landscaping and seasonal work in Harford County, Maryland.",
};

export const viewport = {
  themeColor: "#2f6d3c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-white">{children}</body>
    </html>
  );
}
