"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, MapPin, Phone } from "lucide-react";

import { byOpportunity, contactSummary, type ContactNode } from "@/lib/contact-tree";

/**
 * Who to call, as people rather than as rows of work.
 *
 * Every other screen hangs off a job, which is one piece of work at one
 * address. That is the right unit for doing the work and the wrong one for
 * deciding who to ring: somebody with three properties appeared three times,
 * scored separately, and the fact that they were one customer worth more
 * than any of the three was nowhere on the page.
 *
 * Open a person and you get their properties, and under each the work on it.
 * That is the whole of what the business knows about them, in the shape the
 * tables already store it.
 */
export function PeopleList({ contacts }: { contacts: ContactNode[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const ordered = byOpportunity(contacts);

  if (ordered.length === 0) {
    return (
      <p className="rounded-xl border border-border p-4 text-center text-sm text-muted-foreground">
        Nobody on the books yet.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {ordered.map((contact) => {
        const open = openId === contact.contactId;
        return (
          <li
            key={contact.contactId}
            className="overflow-hidden rounded-xl border border-white/60 bg-card/60 backdrop-blur-md"
          >
            <button
              type="button"
              onClick={() => setOpenId(open ? null : contact.contactId)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{contact.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {contactSummary(contact)}
                </span>
              </span>
              {contact.liveProjects > 0 && (
                <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  {contact.liveProjects} live
                </span>
              )}
              {contact.phone && (
                <a
                  href={`tel:${contact.phone}`}
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0 rounded-lg border border-border p-2"
                  aria-label={`Call ${contact.name}`}
                >
                  <Phone className="h-4 w-4" />
                </a>
              )}
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                  open ? "rotate-180" : ""
                }`}
              />
            </button>

            {open && (
              <div className="flex flex-col gap-2 border-t border-border/60 p-3">
                {contact.properties.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No property on file, so there is nothing to quote yet.
                  </p>
                ) : (
                  contact.properties.map((property) => (
                    <div key={property.propertyId} className="rounded-lg border border-border p-2.5">
                      <p className="flex items-start gap-1.5 text-xs font-medium">
                        <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">{property.address}</span>
                        {property.acreage != null && (
                          <span className="shrink-0 text-muted-foreground">
                            {property.acreage} ac
                          </span>
                        )}
                      </p>

                      {property.projects.length === 0 ? (
                        <p className="mt-1 pl-4.5 text-xs text-muted-foreground">
                          Never quoted.
                        </p>
                      ) : (
                        <ul className="mt-1 flex flex-col gap-0.5">
                          {property.projects.map((project) => (
                            <li key={project.jobId}>
                              <Link
                                href={`/jobs/${project.jobId}`}
                                className="flex items-baseline justify-between gap-2 rounded px-1 py-0.5 text-xs hover:bg-accent/40"
                              >
                                <span className="min-w-0 truncate">
                                  {project.jobNumber ? `#${project.jobNumber} ` : ""}
                                  {project.name}
                                </span>
                                <span className="shrink-0 text-muted-foreground">
                                  {project.status.replace(/_/g, " ")}
                                  {project.value
                                    ? ` · $${Math.round(project.value).toLocaleString()}`
                                    : ""}
                                </span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))
                )}

                <Link
                  href={`/clients/${contact.contactId}`}
                  className="text-xs font-medium text-primary underline"
                >
                  Open their record
                </Link>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
