import Link from "next/link";
import { MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { listProperties } from "@/lib/data/properties";
import { listProfiles } from "@/lib/data/team";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { DeletePropertyButton } from "@/components/property/delete-property-button";
import { AssignJobSelect } from "@/components/property/assign-job-select";

interface PropertyJob {
  id: string;
  name: string;
  assigned_to: string | null;
}

async function getJobsByProperty(propertyIds: string[]) {
  if (propertyIds.length === 0) return new Map<string, PropertyJob[]>();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("id, name, property_id, assigned_to")
    .in("property_id", propertyIds)
    .order("created_at", { ascending: false });

  // Falls back to jobs without assignment info if the "assigned_to" column
  // (added by a later migration) hasn't been applied to this database yet —
  // this page should still work for its core job even if that one migration
  // hasn't been run.
  let rows: { id: string; name: string; property_id: string; assigned_to: string | null }[] = [];
  if (!error) {
    rows = data ?? [];
  } else {
    const fallback = await supabase
      .from("jobs")
      .select("id, name, property_id")
      .in("property_id", propertyIds)
      .order("created_at", { ascending: false });
    rows = (fallback.data ?? []).map((job) => ({ ...job, assigned_to: null }));
  }

  const map = new Map<string, PropertyJob[]>();
  for (const job of rows) {
    if (!map.has(job.property_id)) map.set(job.property_id, []);
    map.get(job.property_id)!.push({ id: job.id, name: job.name, assigned_to: job.assigned_to });
  }
  return map;
}

export default async function PropertiesPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  // listProfiles() depends on the "profiles" table from a later migration —
  // fall back to an empty roster (assignment dropdowns just show
  // "Unassigned") instead of taking the whole page down if it's missing.
  const [properties, profiles] = await Promise.all([listProperties(), listProfiles().catch(() => [])]);
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
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col items-end gap-1.5">
                      {jobs.map((job) => (
                        <div key={job.id} className="flex items-center gap-2">
                          <AssignJobSelect jobId={job.id} initialAssignedTo={job.assigned_to} profiles={profiles} />
                          <Button asChild size="sm" variant="secondary">
                            <Link href={`/jobs/${job.id}`}>{job.name}</Link>
                          </Button>
                        </div>
                      ))}
                    </div>
                    <DeletePropertyButton id={property.id} address={property.address} />
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
