import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import "./globals.css";

export const metadata: Metadata = {
  title: "Celerity",
  description: "Property estimating & job-execution app",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Celerity" },
  icons: {
    apple: "/apple-touch-icon.png",
    icon: [{ url: "/icon-192.png", sizes: "192x192" }, { url: "/icon-512.png", sizes: "512x512" }],
  },
};

export const viewport = {
  themeColor: "#2f6d3c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  let userEmail: string | null = null;
  if (isSupabaseConfigured) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userEmail = user?.email ?? null;
  }

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          <div className="absolute -top-32 -left-24 h-96 w-96 rounded-full bg-primary/35 blur-3xl" />
          <div className="absolute top-1/4 -right-32 h-[28rem] w-[28rem] rounded-full bg-emerald-400/30 blur-3xl" />
          <div className="absolute bottom-0 left-1/4 h-80 w-80 rounded-full bg-teal-400/25 blur-3xl" />
          <div className="absolute bottom-[-6rem] right-1/4 h-72 w-72 rounded-full bg-lime-300/25 blur-3xl" />
        </div>
        <header className="sticky top-0 z-40 border-b border-white/50 bg-card/70 shadow-sm backdrop-blur-xl backdrop-saturate-150">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
            <Link href="/" className="text-lg font-bold text-primary">
              Celerity
            </Link>
            <SiteNav userEmail={userEmail} />
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
