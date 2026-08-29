/**
 * The shape the business actually has: a person, their properties, the work
 * on each.
 *
 * Everything else in the app hangs off a job, which is one piece of work at
 * one address. That is the right unit for doing the work and the wrong unit
 * for deciding who to ring. A person with three properties showed up as three
 * rows, each scored on its own, so nobody could see that the three were one
 * customer worth more than any of them apart.
 *
 * So this assembles what the tables already say. A contact is a person. A
 * person has properties. A property has projects. Nothing invented, nothing
 * stored: two joins and some arithmetic, derived at read time so it cannot
 * drift from the rows it came from.
 */

export interface ProjectNode {
  jobId: string;
  name: string;
  status: string;
  jobNumber: number | null;
  /** What the proposal on it came to, once there is one. */
  value: number | null;
  proposalStatus: string | null;
  /** Whichever of its dates is the most recent thing that happened. */
  at: string | null;
}

export interface PropertyNode {
  propertyId: string;
  address: string;
  acreage: number | null;
  projects: ProjectNode[];
}

export interface ContactNode {
  contactId: string;
  name: string;
  email: string | null;
  phone: string | null;
  contactType: string;
  doNotContact: boolean;
  properties: PropertyNode[];

  // Derived, because a stored total is a total that goes stale.
  propertyCount: number;
  projectCount: number;
  /** Work that is neither finished nor cancelled. */
  liveProjects: number;
  /** What they have actually spent, from work that was won. */
  lifetimeValue: number;
  /** The most recent thing that happened anywhere on their record. */
  lastActivityAt: string | null;
}

/** Work that is over, one way or the other. */
const FINISHED = new Set(["completed", "cancelled"]);

/** A proposal that turned into money. */
const WON = new Set(["accepted"]);

export interface TreeInput {
  contacts: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    contactType: string;
    doNotContact: boolean;
  }[];
  properties: { id: string; customerId: string; address: string; acreage: number | null }[];
  jobs: {
    id: string;
    propertyId: string;
    name: string;
    status: string;
    jobNumber: number | null;
    evaluationDate: string | null;
    projectStartDate: string | null;
    projectEndDate: string | null;
    createdAt: string | null;
  }[];
  proposals: { jobId: string; status: string; totalCost: number | null }[];
}

/** The most recent date on a job, whichever kind it is. */
function latest(dates: (string | null)[]): string | null {
  const real = dates.filter((d): d is string => Boolean(d));
  if (real.length === 0) return null;
  return real.reduce((newest, d) => (d > newest ? d : newest));
}

export function buildContactTree(input: TreeInput): ContactNode[] {
  const proposalByJob = new Map(input.proposals.map((p) => [p.jobId, p]));

  const projectsByProperty = new Map<string, ProjectNode[]>();
  for (const job of input.jobs) {
    const proposal = proposalByJob.get(job.id);
    const list = projectsByProperty.get(job.propertyId) ?? [];
    list.push({
      jobId: job.id,
      name: job.name,
      status: job.status,
      jobNumber: job.jobNumber,
      value: proposal?.totalCost ?? null,
      proposalStatus: proposal?.status ?? null,
      at: latest([job.projectEndDate, job.projectStartDate, job.evaluationDate, job.createdAt]),
    });
    projectsByProperty.set(job.propertyId, list);
  }

  const propertiesByContact = new Map<string, PropertyNode[]>();
  for (const property of input.properties) {
    const list = propertiesByContact.get(property.customerId) ?? [];
    list.push({
      propertyId: property.id,
      address: property.address,
      acreage: property.acreage,
      // Newest work first: what somebody wants to know about an address is
      // what happened there last.
      projects: (projectsByProperty.get(property.id) ?? []).sort((a, b) =>
        (b.at ?? "") < (a.at ?? "") ? -1 : (b.at ?? "") > (a.at ?? "") ? 1 : 0
      ),
    });
    propertiesByContact.set(property.customerId, list);
  }

  return input.contacts.map((contact) => {
    const properties = propertiesByContact.get(contact.id) ?? [];
    const projects = properties.flatMap((p) => p.projects);

    return {
      contactId: contact.id,
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      contactType: contact.contactType,
      doNotContact: contact.doNotContact,
      properties,
      propertyCount: properties.length,
      projectCount: projects.length,
      liveProjects: projects.filter((p) => !FINISHED.has(p.status)).length,
      // Won work only. Counting a quote nobody accepted as money spent is how
      // a list of best customers fills up with people who never bought.
      lifetimeValue: projects
        .filter((p) => p.proposalStatus != null && WON.has(p.proposalStatus))
        .reduce((sum, p) => sum + (p.value ?? 0), 0),
      lastActivityAt: latest(projects.map((p) => p.at)),
    };
  });
}

/** Somebody with a property and no work on any of it. */
export function neverSold(contact: ContactNode): boolean {
  return contact.propertyCount > 0 && contact.lifetimeValue === 0;
}

/** Nothing on the books at all: no property, so nothing to quote. */
export function nothingToWorkWith(contact: ContactNode): boolean {
  return contact.propertyCount === 0;
}

/**
 * The line under a name.
 *
 * Properties and projects and money, in that order, because that is the order
 * somebody asks: who are they, what have we done, what is it worth.
 */
export function contactSummary(contact: ContactNode): string {
  if (nothingToWorkWith(contact)) return "No property on file";

  const parts = [
    `${contact.propertyCount} propert${contact.propertyCount === 1 ? "y" : "ies"}`,
    `${contact.projectCount} project${contact.projectCount === 1 ? "" : "s"}`,
  ];
  if (contact.lifetimeValue > 0) {
    parts.push(
      contact.lifetimeValue.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      })
    );
  }
  return parts.join(" · ");
}

/** Who to put in front of somebody first. */
export function byOpportunity(contacts: ContactNode[]): ContactNode[] {
  return [...contacts]
    .filter((c) => !c.doNotContact)
    .sort((a, b) => {
      // Live work first: those are conversations already happening.
      if (a.liveProjects !== b.liveProjects) return b.liveProjects - a.liveProjects;
      // Then whoever has spent the most, since they are likeliest to again.
      if (a.lifetimeValue !== b.lifetimeValue) return b.lifetimeValue - a.lifetimeValue;
      // Then most properties: more ground is more to quote.
      return b.propertyCount - a.propertyCount;
    });
}
