import type { Metadata } from "next";
import "../globals.css";

/**
 * A local business's own root layout, outside the app shell.
 *
 * Somebody who wanted to advertise in one of our groups, clicking a link from
 * a declined post. Not staff, so no nav — and this layout owns its own
 * stylesheet import, because a root layout outside the (app) group inherits
 * nothing from it.
 */
export const metadata: Metadata = {
  title: "Post your business in the group",
  description: "Reach the neighbours in a local group.",
};

export const viewport = {
  themeColor: "#2f6d3c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default function PromoteLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-foreground">{children}</body>
    </html>
  );
}
