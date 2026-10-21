import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NewPropertyForm } from "@/components/property/new-property-form";
import { isMapboxConfigured, isSupabaseConfigured } from "@/lib/env";

export default function Home() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-bold">New Property Estimate</h1>
        <p className="text-muted-foreground">
          Enter an address to load satellite imagery and start mapping work areas.
        </p>
      </div>

      {!isSupabaseConfigured || !isMapboxConfigured ? (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-destructive">Setup required</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {!isSupabaseConfigured && (
              <p>
                Supabase is not configured. Copy <code>.env.example</code> to{" "}
                <code>.env.local</code> and fill in{" "}
                <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
                <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.
              </p>
            )}
            {!isMapboxConfigured && (
              <p>
                Mapbox is not configured. Fill in{" "}
                <code>NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN</code> in{" "}
                <code>.env.local</code>.
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="pt-6">
          <NewPropertyForm />
        </CardContent>
      </Card>

      <div className="text-center">
        <Button variant="link" asChild>
          <Link href="/properties">View existing properties &rarr;</Link>
        </Button>
      </div>
    </div>
  );
}
