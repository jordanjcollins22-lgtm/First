"use client";

import { useMemo, useState } from "react";
import { Maximize2, User } from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClientDetailPanel } from "./client-detail-panel";
import type { PropertyWithCustomer } from "@/lib/data/properties";
import type { JobWithLocation } from "@/lib/data/jobs";
import type { Customer, Profile } from "@/types/domain";

interface ClientGroup {
  customer: Customer;
  properties: PropertyWithCustomer[];
}

/** Groups properties by client — a client can have several properties, and
 * clicking them shows one account with everything on it, not a single address. */
export function ClientList({
  properties,
  jobs,
  profiles,
  selectedClientId,
  onSelect,
}: {
  properties: PropertyWithCustomer[];
  jobs: JobWithLocation[];
  profiles: Profile[];
  selectedClientId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, ClientGroup>();
    for (const property of properties) {
      const existing = map.get(property.customer_id);
      if (existing) existing.properties.push(property);
      else map.set(property.customer_id, { customer: property.customer, properties: [property] });
    }
    return Array.from(map.values()).sort((a, b) => a.customer.name.localeCompare(b.customer.name));
  }, [properties]);

  const expandedGroup = groups.find((g) => g.customer.id === expandedId) ?? null;

  if (groups.length === 0) {
    return <p className="p-3 text-xs text-muted-foreground">No clients yet.</p>;
  }

  return (
    <>
      <ul className="flex flex-col gap-1 p-2">
        {groups.map((group) => {
          const isSelected = group.customer.id === selectedClientId;
          return (
            <li key={group.customer.id} className="flex flex-col">
              <button
                type="button"
                onClick={() => onSelect(isSelected ? null : group.customer.id)}
                className={`flex w-full items-start gap-2 rounded-md p-1.5 text-left text-sm ${
                  isSelected ? "bg-accent" : "hover:bg-accent/50"
                }`}
              >
                <User className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{group.customer.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {group.properties.length} {group.properties.length === 1 ? "property" : "properties"}
                  </span>
                </span>
              </button>

              {isSelected && (
                <div className="mt-1 rounded-md border border-border bg-card p-2.5">
                  <div className="mb-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setExpandedId(group.customer.id)}
                      title="Expand to a full view"
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                    >
                      <Maximize2 className="h-3.5 w-3.5" />
                      Expand
                    </button>
                  </div>
                  <ClientDetailPanel
                    key={group.customer.id}
                    customer={group.customer}
                    clientProperties={group.properties}
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

      <Dialog open={expandedGroup !== null} onOpenChange={(next) => !next && setExpandedId(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{expandedGroup?.customer.name}</DialogTitle>
          </DialogHeader>
          {expandedGroup && (
            <ClientDetailPanel
              key={expandedGroup.customer.id}
              customer={expandedGroup.customer}
              clientProperties={expandedGroup.properties}
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
