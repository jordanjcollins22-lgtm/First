"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ExternalLink, MapPin, Pencil, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AssignJobSelect } from "@/components/property/assign-job-select";
import { DeletePropertyButton } from "@/components/property/delete-property-button";
import { SatelliteAddressSearch } from "@/components/canvas/satellite-address-search";
import { addPropertyForCustomer, updatePropertyAddress } from "@/lib/actions/property-actions";
import { updateCustomerContact } from "@/lib/actions/customer-actions";
import type { PropertyWithCustomer } from "@/lib/data/properties";
import type { Profile } from "@/types/domain";
import type { JobWithLocation } from "@/lib/data/jobs";
import type { GeocodeSuggestion } from "@/lib/mapbox-geocoding";

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
  const [editingAddress, setEditingAddress] = useState(false);
  const [addingProperty, setAddingProperty] = useState(false);
  const [email, setEmail] = useState(property.customer.email ?? "");
  const [phone, setPhone] = useState(property.customer.phone ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function saveContact(next: { email?: string; phone?: string }) {
    setError(null);
    startTransition(async () => {
      try {
        await updateCustomerContact(property.customer_id, {
          email: (next.email ?? email).trim() || null,
          phone: (next.phone ?? phone).trim() || null,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  function handleAddressPicked(suggestion: GeocodeSuggestion) {
    setError(null);
    startTransition(async () => {
      try {
        await updatePropertyAddress(property.id, { address: suggestion.fullAddress, lat: suggestion.lat, lng: suggestion.lng });
        setEditingAddress(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  function handleNewPropertyPicked(suggestion: GeocodeSuggestion) {
    setError(null);
    startTransition(async () => {
      try {
        await addPropertyForCustomer(property.customer_id, {
          address: suggestion.fullAddress,
          lat: suggestion.lat,
          lng: suggestion.lng,
        });
        setAddingProperty(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{property.customer.name}</p>
          {editingAddress ? (
            <div className="mt-1.5 flex flex-col gap-1.5">
              <SatelliteAddressSearch onSelect={handleAddressPicked} disabled={isPending} />
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditingAddress(false)} disabled={isPending}>
                Cancel
              </Button>
            </div>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
              {property.address}
              <button
                type="button"
                onClick={() => setEditingAddress(true)}
                title="Edit address"
                className="text-muted-foreground hover:text-primary"
              >
                <Pencil className="h-3 w-3" />
              </button>
            </p>
          )}
          {(property.sqft != null || property.acreage != null) && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {property.sqft != null && `${property.sqft.toLocaleString()} sq ft`}
              {property.sqft != null && property.acreage != null && " · "}
              {property.acreage != null && `${property.acreage.toLocaleString()} acres`}
            </p>
          )}
        </div>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label className="text-xs">Email</Label>
          <Input
            type="email"
            value={email}
            placeholder="client@example.com"
            disabled={isPending}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => saveContact({ email })}
            className="h-9 text-sm"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label className="text-xs">Phone</Label>
          <Input
            type="tel"
            value={phone}
            placeholder="(555) 555-5555"
            disabled={isPending}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={() => saveContact({ phone })}
            className="h-9 text-sm"
          />
        </div>
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
                {new Date(job.evaluation_date ?? job.created_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}{" "}
                Evaluation
                <ExternalLink className="h-3 w-3" />
              </Link>
              <span className="text-xs capitalize text-muted-foreground">{job.status.replace("_", " ")}</span>
              <AssignJobSelect jobId={job.id} initialAssignedTo={job.assigned_to} profiles={profiles} />
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border pt-3">
        {addingProperty ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-muted-foreground">New address for {property.customer.name}</p>
            <SatelliteAddressSearch onSelect={handleNewPropertyPicked} disabled={isPending} />
            <Button type="button" size="sm" variant="ghost" onClick={() => setAddingProperty(false)} disabled={isPending}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={() => setAddingProperty(true)} className="self-start">
            <Plus className="h-3.5 w-3.5" />
            Add another property for this client
          </Button>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border pt-3">
        <span className="text-xs text-muted-foreground">Deleting removes this property and all its jobs.</span>
        <DeletePropertyButton id={property.id} address={property.address} />
      </div>
    </div>
  );
}
