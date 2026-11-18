import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ImpersonationBanner } from "@/components/impersonation-banner";
import { ThemeToggle } from "@/components/theme-toggle";
import { logout } from "@/lib/actions/auth-actions";
import { getCurrentProfile, getRealProfile } from "@/lib/data/team";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { themeScript } from "@/lib/theme";
import "../globals.css";

// Sixty seconds for every page under the app, not the platform's ten.
export const maxDuration = 60;

export const metadata: Metadata = {
  metadataBase: new URL("https://app.jslandscapingmd.com"),
  title: "JS Landscaping",
  description: "JS Landscaping",
  openGraph: { siteName: "JS Landscaping MD", type: "website" },
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "JS Landscaping" },
  icons: {
    apple: "/apple-touch-icon.png",
    icon: [{ url: "/icon-192.png", sizes: "192x192" }, { url: "/icon-512.png", sizes: "512x512" }],
  },
};

export const viewport = {
  themeColor: "#0e7c74",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

/**
 * The fresh app's frame: one thin bar (the name, which goes home, the
 * light/dark switch, and Sign out) over each person's page. No menu: everything a person uses is on
 * their own page or one tap from it.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let signedIn = false;
  let viewingAs: string | null = null;
  if (isSupabaseConfigured) {
    const real = await getRealProfile();
    if (!real) {
      // Signed in with no staff profile is a client: their own corner.
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) redirect("/my");
    } else {
      signedIn = true;
      const profile = await getCurrentProfile();
      if (profile && profile.id !== real.id) viewingAs = profile.full_name || profile.email;
    }
  }

  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript() }} />
      </head>
      <body className="vx-body min-h-full flex flex-col">
        {viewingAs && <ImpersonationBanner name={viewingAs} />}
        <header className="vx-top">
          <Link href={signedIn ? "/me" : "/login"}>JS Landscaping</Link>
          <div className="vx-top-r">
            <ThemeToggle />
            {signedIn && (
              <form action={logout}>
                <button type="submit">Sign out</button>
              </form>
            )}
          </div>
        </header>
        <main className="flex-1 pb-[env(safe-area-inset-bottom)]">{children}</main>
      </body>
    </html>
  );
}
