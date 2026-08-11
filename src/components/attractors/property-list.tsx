"use client";

import { MapPin } from "lucide-react";

import type { PropertyWithCustomer } from "@/lib/data/properties";

export function PropertyList({
  properties,
  selectedPropertyId,
  onSelect,
}: {
  properties: PropertyWithCustomer[];
  selectedPropertyId: string | null;
  onSelect: (id: string) => void;
}) {
  if (properties.length === 0) {
    return <p className="p-3 text-xs text-muted-foreground">No properties yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-1 p-2">
      {properties.map((property) => (
        <li key={property.id}>
          <button
            type="button"
            onClick={() => onSelect(property.id)}
            className={`flex w-full items-start gap-2 rounded-md p-1.5 text-left text-sm ${
              property.id === selectedPropertyId ? "bg-accent" : "hover:bg-accent/50"
            }`}
          >
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{property.customer.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{property.address}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
