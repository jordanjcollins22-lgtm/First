import type { Metadata } from "next";
import "../globals.css";

/**
 * The client's own corner, with its own root layout.
 *
 * Deliberately outside the app's layout: this is a homeowner looking at their
 * own quote, and the staff navigation has no business being drawn around it —
 * not as a matter of taste but because half the links would refuse them.
 */
export const metadata: Metadata = {
  title: "Your projects",
  description: "Your quotes, visits and work with us",
};

export const viewport = {
  themeColor: "#2f6d3c",
  width: "device-width",
  initialScale: 1,
};

export default function MyLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background">{children}</body>
    </html>
  );
}
