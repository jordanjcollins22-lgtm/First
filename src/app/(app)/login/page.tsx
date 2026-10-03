import Link from "next/link";
import { redirect } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import { LoginForm } from "@/components/auth/login-form";
import { CodeLoginForm } from "@/components/auth/code-login-form";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { safeReturnTo } from "@/lib/return-to";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ password?: string; code?: string; next?: string }>;
}) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  // Password by default for now: the code email depends on mail that is not
  // sending yet. The code door stays at /login?code=1 for the day it is.
  const { code, next } = await searchParams;
  const withCode = code === "1";
  // Where they were going before the sign-in page got in the way.
  const returnTo = safeReturnTo(next);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect(returnTo);

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
      <div>
        <h1 className="text-2xl font-bold">Sign in</h1>
        <p className="text-muted-foreground">
          {withCode ? "JS Landscaping. No password: we email you a code." : "JS Landscaping"}
        </p>
      </div>
      <Card>
        <CardContent className="pt-6">{withCode ? <CodeLoginForm next={returnTo} /> : <LoginForm next={returnTo} />}</CardContent>
      </Card>
      <p className="text-center text-xs text-muted-foreground">
        {withCode ? (
          <Link href={next ? `/login?next=${encodeURIComponent(returnTo)}` : "/login"} className="underline">
            Sign in with a password instead
          </Link>
        ) : (
          <Link href={next ? `/login?code=1&next=${encodeURIComponent(returnTo)}` : "/login?code=1"} className="underline">
            Email me a code instead
          </Link>
        )}
      </p>
    </div>
  );
}
