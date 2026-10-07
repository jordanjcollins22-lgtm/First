import { describe, expect, it } from "vitest";

import { bookingPageKey, claimBooking, ghlKey, releaseClaim, settleClaim } from "@/lib/data/booking-claims";

/** Just enough of the database for claims: one table, a primary key, and the filters the claims use. */
function fakeAdmin() {
  const rows = new Map<string, { key: string; job_id: string | null; created_at: string }>();
  const query = (filters: [string, string, unknown][] = []) => {
    const match = (r: Record<string, unknown>) =>
      filters.every(([op, col, v]) => (op === "eq" ? r[col] === v : op === "is" ? r[col] === v : true));
    const api = {
      eq: (col: string, v: unknown) => query([...filters, ["eq", col, v]]),
      is: (col: string, v: unknown) => query([...filters, ["is", col, v]]),
      maybeSingle: async () => ({ data: [...rows.values()].find(match) ?? null }),
      select: () => api,
      _filters: filters,
      _match: match,
    };
    return api;
  };
  const admin = {
    from: () => ({
      insert: async (row: { key: string }) => {
        if (rows.has(row.key)) return { error: { code: "23505", message: "duplicate key" } };
        rows.set(row.key, { key: row.key, job_id: null, created_at: new Date().toISOString() });
        return { error: null };
      },
      select: () => query(),
      update: (patch: Record<string, unknown>) => {
        const run = (filters: [string, string, unknown][]) => {
          const q = query(filters);
          const apply = () => {
            const hit = [...rows.values()].filter(q._match);
            hit.forEach((r) => Object.assign(r, patch));
            return hit[0] ?? null;
          };
          const chain = {
            eq: (c: string, v: unknown) => run([...filters, ["eq", c, v]]),
            is: (c: string, v: unknown) => run([...filters, ["is", c, v]]),
            select: () => ({ maybeSingle: async () => ({ data: apply() }) }),
            then: (resolve: (v: unknown) => void) => resolve({ data: apply(), error: null }),
          };
          return chain;
        };
        return run([]);
      },
      delete: () => {
        const run = (filters: [string, string, unknown][]) => {
          const q = query(filters);
          return {
            eq: (c: string, v: unknown) => run([...filters, ["eq", c, v]]),
            is: (c: string, v: unknown) => run([...filters, ["is", c, v]]),
            then: (resolve: (v: unknown) => void) => {
              [...rows.values()].filter(q._match).forEach((r) => rows.delete(r.key));
              resolve({ error: null });
            },
          };
        };
        return run([]);
      },
    }),
  };
  return { admin: admin as never, rows };
}

describe("one booking, made once", () => {
  it("lets the first copy make it and hands the second the same job", async () => {
    const { admin } = fakeAdmin();
    const key = ghlKey("appt-1");
    expect(await claimBooking(admin, key)).toEqual({ won: true });
    const second = claimBooking(admin, key);
    await settleClaim(admin, key, "job-68");
    expect(await second).toEqual({ won: false, jobId: "job-68" });
  });

  it("lets a failed booking be tried again", async () => {
    const { admin } = fakeAdmin();
    const key = bookingPageKey("org", "Client@Example.com", "2026-10-09T16:30");
    expect(key).toBe("book:org:client@example.com:2026-10-09T16:30");
    expect(await claimBooking(admin, key)).toEqual({ won: true });
    await releaseClaim(admin, key);
    expect(await claimBooking(admin, key)).toEqual({ won: true });
  });
});
