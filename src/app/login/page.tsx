import { redirect } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import { LoginForm } from "@/components/auth/login-form";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupRequiredNotice } from "@/components/setup-required-notice";

export default async function LoginPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/");

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
      <div>
        <h1 className="text-2xl font-bold">Sign in</h1>
        <p className="text-muted-foreground">Field Estimator</p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <LoginForm />
        </CardContent>
      </Card>
    </div>
  );
}
