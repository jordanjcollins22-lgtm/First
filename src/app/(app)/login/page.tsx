import { redirect } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import { LoginForm } from "@/components/auth/login-form";
import { CodeLoginForm } from "@/components/auth/code-login-form";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupRequiredNotice } from "@/components/setup-required-notice";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ password?: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  // The password door stays, unlinked, for the day the code email does not
  // arrive: /login?password=1. Everyone else signs in with a code.
  const { password } = await searchParams;
  const withPassword = password === "1";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/");

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
      <div>
        <h1 className="text-2xl font-bold">Sign in</h1>
        <p className="text-muted-foreground">
          {withPassword ? "JS Landscaping" : "JS Landscaping. No password: we email you a code."}
        </p>
      </div>
      <Card>
        <CardContent className="pt-6">{withPassword ? <LoginForm /> : <CodeLoginForm />}</CardContent>
      </Card>
    </div>
  );
}
