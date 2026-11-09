import type { Metadata } from "next";
import "../globals.css";

/**
 * Root layout for shared case-file links, outside the (app) group, so the
 * person holding the link (our lawyer, an insurer) gets the stylesheet and
 * no staff navigation. Same shape as /receipt.
 */
export const metadata: Metadata = {
  metadataBase: new URL("https://app.jslandscapingmd.com"),
  title: "Shared files · JS Landscaping",
  description: "Files shared by JS Landscaping",
  robots: { index: false, follow: false },
};

export const viewport = {
  themeColor: "#2f6d3c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default function FilesLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
