import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { AdminChatWidget } from "@/components/admin/admin-chat-widget";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, getRealProfile } from "@/lib/data/team";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { listRolePermissions } from "@/lib/data/permissions";
import { tabsAllowedForRoles } from "@/lib/permissions";
import { isSupabaseConfigured } from "@/lib/env";
import "../globals.css";

export const metadata: Metadata = {
  title: "JS Landscaping",
  description: "Property estimating & job-execution app",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "JS Landscaping" },
  icons: {
    apple: "/apple-touch-icon.png",
    icon: [{ url: "/icon-192.png", sizes: "192x192" }, { url: "/icon-512.png", sizes: "512x512" }],
  },
};

export const viewport = {
  themeColor: "#2f6d3c",
  width: "device-width",
  initialScale: 1,
  // Zoom stays available on purpose. Locking it out makes the app feel more
  // native, but it also means anyone who needs to enlarge a licence number or
  // an address in the sun simply can't.
  maximumScale: 5,
  userScalable: true,
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let userEmail: string | null = null;
  let roles: string[] = [];
  let allowedTabs: string[] = [];
  let impersonatingName: string | null = null;
  let orgName: string | null = null;
  if (isSupabaseConfigured) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userEmail = user?.email ?? null;
    if (user) {
      const [profile, realProfile, org] = await Promise.all([
        getCurrentProfile(),
        getRealProfile(),
        getCurrentOrganization().catch(() => null),
      ]);
      roles = profile?.roles ?? [];
      orgName = org?.name ?? null;
      if (profile && realProfile && profile.id !== realProfile.id) {
        impersonatingName = profile.full_name || profile.email;
      }
      // Not auto-granted for admins — see the note in lib/data/access.ts.
      // The Permissions nav link itself stays role-gated below, independent
      // of this list, so there's always a way back in.
      const permissions = await listRolePermissions().catch(() => []);
      allowedTabs = Array.from(tabsAllowedForRoles(roles, permissions));
    }
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
        {impersonatingName && <ImpersonationBanner name={impersonatingName} />}
        <header className="sticky top-0 z-40 border-b border-white/50 bg-card/70 shadow-sm backdrop-blur-xl backdrop-saturate-150">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
            <Link href="/" className="text-lg font-bold text-primary">
              {orgName ?? "JS Landscaping"}
            </Link>
            <SiteNav userEmail={userEmail} roles={roles} allowedTabs={allowedTabs} />
          </div>
        </header>
        <main className="flex-1">{children}</main>
        {roles.includes("admin") && <AdminChatWidget />}
      </body>
    </html>
  );
}
