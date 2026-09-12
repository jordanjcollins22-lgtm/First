import type { Metadata } from "next";
import "../globals.css";

/**
 * The client's own root layout, outside the (app) group.
 *
 * Without one of these the page renders with no stylesheet at all: the
 * theme, the fonts and every utility class live in globals.css, and only a
 * layout can import it. Same shape as /proposal and /book, for the same
 * reason. No staff navigation, because the person holding this link is a
 * client.
 */
export const metadata: Metadata = {
  title: "Thank you",
  description: "Leave something for the crew",
};

export const viewport = {
  themeColor: "#2f6d3c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
