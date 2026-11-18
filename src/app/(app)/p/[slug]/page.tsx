import { notFound, redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LoginForm } from "@/components/auth/login-form";
import { logout } from "@/lib/actions/auth-actions";
import { getRealProfile } from "@/lib/data/team";
import { isSupabaseConfigured } from "@/lib/env";
import { dashboardPath, roleHomePath } from "@/lib/personal-link";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { v2RolesOf } from "@/lib/v2-roles";
import { SetupRequiredNotice } from "@/components/setup-required-notice";

export const dynamic = "force-dynamic";

/**
 * Somebody's own link to their page. Still a sign-in: signed out, it is the
 * sign-in form with their email filled in, and after it they land back here
 * and go on to their own role's page. Signed in as somebody else, it says so
 * rather than quietly showing the wrong person's page.
 */
export default async function PersonalLinkPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const { slug } = await params;
  const admin = createAdminClient();
  const { data: owner } = await admin
    .from("profiles")
    .select("id, full_name, email")
    .eq("dashboard_slug", slug.toLowerCase())
    .maybeSingle();
  if (!owner) notFound();
  const name = (owner.full_name ?? "").trim().split(/\s+/)[0] || null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user && user.id === owner.id) {
    const me = await getRealProfile();
    redirect(me ? roleHomePath(v2RolesOf(me)) : "/");
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
      <div>
        <h1 className="text-2xl font-bold">{name ? `Hi ${name}, sign in` : "Sign in"}</h1>
        <p className="text-muted-foreground">JS Landscaping. This is your own link to your page: save it to your home screen.</p>
      </div>
      <Card>
        <CardContent className="pt-6">
          {user ? (
            <div className="grid gap-4 text-sm">
              <p>This link is for {name ?? owner.email}, and you&apos;re signed in as somebody else. Sign out first to use it.</p>
              <form action={logout}>
                <Button type="submit" size="xl" className="w-full">Sign out</Button>
              </form>
            </div>
          ) : (
            <LoginForm next={dashboardPath(slug)} email={owner.email ?? undefined} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
