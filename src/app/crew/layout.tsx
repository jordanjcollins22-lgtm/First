import type { Metadata } from "next";
import "../globals.css";

/**
 * The crew's own root layout, outside the (app) group.
 *
 * Without it the crew map rendered with no stylesheet at all (serif text, a
 * raw blue link, square number boxes), because globals.css can only come in
 * through a layout. No staff navigation: the person holding this link is a
 * technician in the field with no login.
 */
export const metadata: Metadata = {
  metadataBase: new URL("https://app.jslandscapingmd.com"),
  title: "Crew map · JS Landscaping",
};

export const viewport = {
  themeColor: "#0f766e",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default function CrewLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-foreground">{children}</body>
    </html>
  );
}
