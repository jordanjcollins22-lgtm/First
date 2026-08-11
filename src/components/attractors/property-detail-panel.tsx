"use client";

import Link from "next/link";
import { ExternalLink, MapPin, X } from "lucide-react";

import { AssignJobSelect } from "@/components/property/assign-job-select";
import { DeletePropertyButton } from "@/components/property/delete-property-button";
import type { PropertyWithCustomer } from "@/lib/data/properties";
import type { Profile } from "@/types/domain";
import type { JobWithLocation } from "@/lib/data/jobs";

export function PropertyDetailPanel({
  property,
  jobs,
  profiles,
  onClose,
}: {
  property: PropertyWithCustomer;
  jobs: JobWithLocation[];
  profiles: Profile[];
  onClose: () => void;
}) {
  const propertyJobs = jobs.filter((j) => j.property_id === property.id);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 font-semibold">
            <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            {property.address}
          </p>
          <p className="text-xs text-muted-foreground">{property.customer.name}</p>
        </div>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-muted-foreground">Jobs</p>
        {propertyJobs.length === 0 ? (
          <p className="text-xs text-muted-foreground">No jobs on this property yet.</p>
        ) : (
          propertyJobs.map((job) => (
            <div key={job.id} className="flex flex-col gap-1.5 rounded-lg border border-border p-2.5">
              <Link
                href={`/jobs/${job.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm font-medium text-primary underline-offset-2 hover:underline"
              >
                {job.name} <ExternalLink className="h-3 w-3" />
              </Link>
              <AssignJobSelect jobId={job.id} initialAssignedTo={job.assigned_to} profiles={profiles} />
            </div>
          ))
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border pt-3">
        <span className="text-xs text-muted-foreground">Deleting removes this property and all its jobs.</span>
        <DeletePropertyButton id={property.id} address={property.address} />
      </div>
    </div>
  );
}
