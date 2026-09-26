import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * A bucket nobody can write to is a feature that does not work.
 *
 * `recommendation-shots` shipped private with no policy on storage.objects at
 * all, which refuses every write including from the staff member the whole
 * feature is for. Asking for an upload URL came back "new row violates
 * row-level security policy", and that reached somebody standing in a garden
 * trying to answer a post.
 *
 * Nothing caught it. A type check cannot see a storage policy, and every unit
 * test passed because the failure lives in the database. So it is checked here
 * against the migrations themselves: create a bucket, and you have to say who
 * may read it and who may write to it.
 */
const DIR = "supabase/migrations";

function migrations(): { file: string; sql: string }[] {
  return readdirSync(DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(DIR, file), "utf8") }));
}

const ALL = migrations();
const EVERY_LINE = ALL.map((migration) => migration.sql).join("\n");

/** Bucket ids, from the rows that create them. */
function bucketsCreated(): string[] {
  const found = new Set<string>();
  // insert into storage.buckets (id, name, public) values ('thing', ...)
  const inserts = EVERY_LINE.matchAll(
    /insert\s+into\s+storage\.buckets[\s\S]*?values\s*([\s\S]*?);/gi
  );
  for (const insert of inserts) {
    for (const quoted of insert[1].matchAll(/\(\s*'([a-z0-9-]+)'/gi)) found.add(quoted[1]);
  }
  return Array.from(found).sort();
}

describe("storage buckets", () => {
  it("finds the migrations at all, so this cannot pass by looking at nothing", () => {
    expect(ALL.length).toBeGreaterThan(50);
    expect(bucketsCreated().length).toBeGreaterThan(5);
  });

  it("gives every bucket a policy that lets somebody write to it", () => {
    for (const bucket of bucketsCreated()) {
      const policies = policiesMentioning(bucket);
      expect(
        policies.some((policy) => /for\s+insert|with\s+check/i.test(policy)),
        `bucket "${bucket}" is created but nothing may upload to it`
      ).toBe(true);
    }
  });

  it("gives every bucket a policy that lets somebody read it back", () => {
    for (const bucket of bucketsCreated()) {
      const policies = policiesMentioning(bucket);
      expect(
        policies.some((policy) => /for\s+select/i.test(policy)),
        `bucket "${bucket}" is created but nothing may read it`
      ).toBe(true);
    }
  });
});

/** Every `create policy ... on storage.objects` that names this bucket. */
function policiesMentioning(bucket: string): string[] {
  const out: string[] = [];
  const policies = EVERY_LINE.matchAll(
    /create\s+policy[\s\S]*?on\s+storage\.objects([\s\S]*?);/gi
  );
  for (const policy of policies) {
    if (policy[1].includes(`'${bucket}'`)) out.push(policy[1]);
  }
  return out;
}
