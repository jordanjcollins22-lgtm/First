"use client";

import { useState } from "react";
import { MapPin, Maximize2 } from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PropertyDetailPanel } from "./property-detail-panel";
import type { PropertyWithCustomer } from "@/lib/data/properties";
import type { JobWithLocation } from "@/lib/data/jobs";
import type { Profile } from "@/types/domain";

export function PropertyList({
  properties,
  jobs,
  profiles,
  selectedPropertyId,
  onSelect,
}: {
  properties: PropertyWithCustomer[];
  jobs: JobWithLocation[];
  profiles: Profile[];
  selectedPropertyId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const expandedProperty = properties.find((p) => p.id === expandedId) ?? null;

  if (properties.length === 0) {
    return <p className="p-3 text-xs text-muted-foreground">No properties yet.</p>;
  }

  return (
    <>
      <ul className="flex flex-col gap-1 p-2">
        {properties.map((property) => {
          const isSelected = property.id === selectedPropertyId;
          return (
            <li key={property.id} className="flex flex-col">
              <button
                type="button"
                onClick={() => onSelect(isSelected ? null : property.id)}
                className={`flex w-full items-start gap-2 rounded-md p-1.5 text-left text-sm ${
                  isSelected ? "bg-accent" : "hover:bg-accent/50"
                }`}
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{property.customer.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{property.address}</span>
                </span>
              </button>

              {isSelected && (
                <div className="mt-1 rounded-md border border-border bg-card p-2.5">
                  <div className="mb-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setExpandedId(property.id)}
                      title="Expand to a full view"
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                    >
                      <Maximize2 className="h-3.5 w-3.5" />
                      Expand
                    </button>
                  </div>
                  <PropertyDetailPanel
                    key={property.id}
                    property={property}
                    jobs={jobs}
                    profiles={profiles}
                    onClose={() => onSelect(null)}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <Dialog open={expandedProperty !== null} onOpenChange={(next) => !next && setExpandedId(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{expandedProperty?.customer.name}</DialogTitle>
          </DialogHeader>
          {expandedProperty && (
            <PropertyDetailPanel
              key={expandedProperty.id}
              property={expandedProperty}
              jobs={jobs}
              profiles={profiles}
              onClose={() => setExpandedId(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
