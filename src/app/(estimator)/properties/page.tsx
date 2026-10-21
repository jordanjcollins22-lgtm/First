import Link from "next/link";
import { MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { listProperties } from "@/lib/data/properties";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupRequiredNotice } from "@/components/setup-required-notice";

async function getJobsByProperty(propertyIds: string[]) {
  if (propertyIds.length === 0) return new Map<string, { id: string; name: string }[]>();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("id, name, property_id")
    .in("property_id", propertyIds)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const map = new Map<string, { id: string; name: string }[]>();
  for (const job of data ?? []) {
    if (!map.has(job.property_id)) map.set(job.property_id, []);
    map.get(job.property_id)!.push({ id: job.id, name: job.name });
  }
  return map;
}

export default async function PropertiesPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const properties = await listProperties();
  const jobsByProperty = await getJobsByProperty(properties.map((p) => p.id));

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Properties</h1>
        <Button asChild>
          <Link href="/">+ New Property</Link>
        </Button>
      </div>

      {properties.length === 0 ? (
        <p className="text-muted-foreground">
          No properties yet. Create one to get started.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {properties.map((property) => {
            const jobs = jobsByProperty.get(property.id) ?? [];
            return (
              <Card key={property.id}>
                <CardContent className="flex items-center justify-between gap-4 pt-6">
                  <div>
                    <p className="flex items-center gap-2 font-semibold">
                      <MapPin className="h-4 w-4 text-primary" />
                      {property.address}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {property.customer.name}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {jobs.map((job) => (
                      <Button key={job.id} asChild size="sm" variant="secondary">
                        <Link href={`/jobs/${job.id}`}>{job.name}</Link>
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
