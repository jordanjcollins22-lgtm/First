import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { govconLogin } from "@/lib/actions/govcon-actions";

export default async function GovconLoginPage({ searchParams }: PageProps<"/govcon/login">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/govcon";
  const configured = Boolean(process.env.GOVCON_DASHBOARD_PASSWORD);
  return (
    <Card className="mx-auto mt-10 max-w-sm">
      <CardHeader>
        <CardTitle>Gov contracts dashboard</CardTitle>
      </CardHeader>
      <CardContent>
        {!configured ? (
          <p className="text-sm text-muted-foreground">
            Set <code>GOVCON_DASHBOARD_PASSWORD</code> in the environment to enable the dashboard.
          </p>
        ) : (
          <form action={govconLogin} className="space-y-3">
            <input type="hidden" name="next" value={next} />
            <Input name="password" type="password" placeholder="Password" autoFocus required />
            {sp.error && <p className="text-sm text-destructive">Wrong password.</p>}
            <Button type="submit" className="w-full">Sign in</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
