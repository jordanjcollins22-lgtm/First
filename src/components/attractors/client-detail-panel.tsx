"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ExternalLink, MapPin, Pencil, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AssignJobSelect } from "@/components/property/assign-job-select";
import { AssignAccountManagerSelect } from "@/components/property/assign-account-manager-select";
import { DeletePropertyButton } from "@/components/property/delete-property-button";
import { SatelliteAddressSearch } from "@/components/canvas/satellite-address-search";
import { addPropertyForCustomer, updatePropertyAddress } from "@/lib/actions/property-actions";
import { updateCustomerContact } from "@/lib/actions/customer-actions";
import { isAccountManager } from "@/lib/affiliate-roles";
import { JOB_STATUS_LABELS } from "@/lib/job-lifecycle";
import { AddJobButton } from "@/components/job/add-job-button";
import { cn } from "@/lib/utils";
import type { PropertyWithCustomer } from "@/lib/data/properties";
import type { Customer, JobProposal, Profile } from "@/types/domain";
import type { JobWithLocation } from "@/lib/data/jobs";
import type { GeocodeSuggestion } from "@/lib/mapbox-geocoding";

const PROPOSAL_STATUS_LABEL: Record<string, string> = {
  needs_approval: "Needs approval",
  sent: "Proposal sent",
  accepted: "Proposal accepted",
  declined: "Proposal declined",
};

const PROPOSAL_STATUS_STYLE: Record<string, string> = {
  needs_approval: "border-amber-400/40 bg-amber-400/10 text-amber-700",
  sent: "border-blue-400/40 bg-blue-400/10 text-blue-700",
  accepted: "border-primary/40 bg-primary/10 text-primary",
  declined: "border-destructive/40 bg-destructive/10 text-destructive",
};

/** The full account view for a client — every property they have, and every
 * job/evaluation on each one, with all the info from how the lead came in. */
export function ClientDetailPanel({
  customer,
  clientProperties,
  jobs,
  profiles,
  proposalsByJobId,
  onClose,
}: {
  customer: Customer;
  clientProperties: PropertyWithCustomer[];
  jobs: JobWithLocation[];
  profiles: Profile[];
  proposalsByJobId?: Record<string, JobProposal>;
  onClose?: () => void;
}) {
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [addingProperty, setAddingProperty] = useState(false);
  const [email, setEmail] = useState(customer.email ?? "");
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const profileNamesById = new Map(profiles.map((p) => [p.id, p.full_name || p.email]));
  const propertyIds = new Set(clientProperties.map((p) => p.id));
  const clientJobs = jobs.filter((j) => propertyIds.has(j.property_id));
  const accountManagerProfiles = profiles.filter((p) => isAccountManager(p.roles));

  function saveContact(next: { email?: string; phone?: string }) {
    setError(null);
    startTransition(async () => {
      try {
        await updateCustomerContact(customer.id, {
          email: (next.email ?? email).trim() || null,
          phone: (next.phone ?? phone).trim() || null,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  function handleAddressPicked(propertyId: string, suggestion: GeocodeSuggestion) {
    setError(null);
    startTransition(async () => {
      try {
        await updatePropertyAddress(propertyId, {
          address: suggestion.fullAddress,
          lat: suggestion.lat,
          lng: suggestion.lng,
        });
        setEditingAddressId(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  function handleNewPropertyPicked(suggestion: GeocodeSuggestion) {
    setError(null);
    startTransition(async () => {
      try {
        await addPropertyForCustomer(customer.id, {
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
        <p className="text-sm font-semibold">{customer.name}</p>
        {onClose && (
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        )}
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

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Account manager</Label>
        <AssignAccountManagerSelect
          customerId={customer.id}
          initialAccountManagerId={customer.account_manager_id}
          profiles={accountManagerProfiles}
        />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-muted-foreground">Properties &amp; jobs</p>
        {clientProperties.length === 0 && <p className="text-xs text-muted-foreground">No properties yet.</p>}
        {clientProperties.map((property) => {
          const propertyJobs = clientJobs.filter((j) => j.property_id === property.id);
          return (
            <div key={property.id} className="flex flex-col gap-2 rounded-lg border border-border p-2.5">
              <div className="flex items-start justify-between gap-2">
                {editingAddressId === property.id ? (
                  <div className="flex flex-1 flex-col gap-1.5">
                    <SatelliteAddressSearch onSelect={(s) => handleAddressPicked(property.id, s)} disabled={isPending} />
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditingAddressId(null)} disabled={isPending}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                    {property.address}
                    <button
                      type="button"
                      onClick={() => setEditingAddressId(property.id)}
                      title="Edit address"
                      className="text-muted-foreground hover:text-primary"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </p>
                )}
                <DeletePropertyButton id={property.id} address={property.address} />
              </div>

              {(property.sqft != null || property.acreage != null) && (
                <p className="text-xs text-muted-foreground">
                  {property.sqft != null && `${property.sqft.toLocaleString()} sq ft`}
                  {property.sqft != null && property.acreage != null && " · "}
                  {property.acreage != null && `${property.acreage.toLocaleString()} acres`}
                </p>
              )}

              <div className="flex flex-col gap-1.5">
                <AddJobButton propertyId={property.id} address={property.address} />
                {propertyJobs.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No jobs on this property yet.</p>
                ) : (
                  propertyJobs.map((job) => (
                    <div key={job.id} className="flex flex-col gap-1.5 rounded-md border border-border/60 bg-muted/20 p-2">
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
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs capitalize text-muted-foreground">
                          {JOB_STATUS_LABELS[job.status] ?? job.status.replace("_", " ")}
                        </span>
                        {proposalsByJobId?.[job.id] && (
                          <span
                            className={cn(
                              "rounded-full border px-1.5 py-0 text-[10px] font-semibold",
                              PROPOSAL_STATUS_STYLE[proposalsByJobId[job.id].status]
                            )}
                          >
                            {PROPOSAL_STATUS_LABEL[proposalsByJobId[job.id].status]}
                          </span>
                        )}
                      </div>
                      {job.budget_range && (
                        <span className="text-xs text-muted-foreground">Budget: {job.budget_range}</span>
                      )}
                      {job.client_notes && (
                        <span className="text-xs text-muted-foreground">Notes: {job.client_notes}</span>
                      )}
                      {job.referred_by_profile_id && profileNamesById.get(job.referred_by_profile_id) && (
                        <span className="text-xs text-muted-foreground">
                          Booked via: {profileNamesById.get(job.referred_by_profile_id)}&apos;s link
                        </span>
                      )}
                      <AssignJobSelect jobId={job.id} initialAssignedTo={job.assigned_to} profiles={profiles} />
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border pt-3">
        {addingProperty ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-muted-foreground">New address for {customer.name}</p>
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
    </div>
  );
}
