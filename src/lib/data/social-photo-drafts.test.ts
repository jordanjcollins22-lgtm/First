import { describe, expect, it } from "vitest";

import { catchUpJobDrafts, makeBacklogDraft, makeJobDraft } from "@/lib/data/social-photo-drafts";
import { runSocialAutopilot } from "@/lib/data/social-autopost-run";
import { DEFAULT_AUTOPILOT } from "@/lib/marketing/autopilot-settings";
import { draftProblems } from "@/lib/social/photo-drafts";

/**
 * A stand-in for the Supabase client: tables in memory, eq / in filters on
 * plain columns, inserts and updates recorded. Enough to drive the draft
 * makers end to end without a database.
 */
type Row = Record<string, unknown>;

function fakeDb(tables: Record<string, Row[]>, opts: { uniqueJobDrafts?: boolean } = {}) {
  const inserts: { table: string; row: Row }[] = [];
  const updates: { table: string; values: Row; filters: [string, unknown][] }[] = [];
  let seq = 0;

  function from(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    const eqs: [string, unknown][] = [];
    let mode: "select" | "insert" | "update" = "select";
    let payload: Row[] = [];
    let values: Row = {};
    let error: { code?: string; message: string } | null = null;

    const run = () => {
      if (mode === "insert") {
        if (error) return { data: null, error };
        return { data: payload.map((r) => ({ id: r.id })), error: null };
      }
      if (mode === "update") {
        updates.push({ table, values, filters: eqs });
        return { data: null, error: null };
      }
      return { data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null };
    };

    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        eqs.push([col, val]);
        if (!col.includes(".")) filters.push((r) => !(col in r) || r[col] === val);
        return builder;
      },
      in: (col: string, vals: unknown[]) => {
        if (!col.includes(".")) filters.push((r) => !(col in r) || vals.includes(r[col]));
        return builder;
      },
      not: () => builder,
      is: () => builder,
      gte: () => builder,
      lte: () => builder,
      lt: () => builder,
      neq: () => builder,
      or: () => builder,
      order: () => builder,
      limit: () => builder,
      insert: (rows: Row | Row[]) => {
        mode = "insert";
        payload = (Array.isArray(rows) ? rows : [rows]).map((r) => ({ id: `new-${++seq}`, ...r }));
        for (const r of payload) {
          const clash =
            opts.uniqueJobDrafts &&
            r.auto_source === "crew_photos" &&
            (tables[table] ?? []).some((x) => x.job_id === r.job_id && x.auto_source === "crew_photos");
          if (clash) error = { code: "23505", message: "duplicate key value violates unique constraint" };
        }
        if (!error) {
          for (const r of payload) {
            inserts.push({ table, row: r });
            (tables[table] ??= []).push(r);
          }
        }
        return builder;
      },
      update: (v: Row) => {
        mode = "update";
        values = v;
        return builder;
      },
      maybeSingle: async () => {
        const r = run();
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
      },
      single: async () => {
        const r = run();
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
      },
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => Promise.resolve(run()).then(resolve, reject),
    };
    return builder;
  }

  return { client: { from }, inserts, updates, tables };
}

const ORG = "org-1";
const NOW = new Date("2026-11-13T15:00:00Z");
const BOOK = "https://app.example.com/book";

function jobTables(photos: Row[], posts: Row[] = []) {
  return {
    organizations: [{ id: ORG, name: "JS Landscaping", business_phone: "443-819-1521" }],
    jobs: [
      {
        id: "job-1",
        job_number: 412,
        status: "completed",
        properties: { address: "12 Oak Lane, Bel Air, MD 21014", customers: { organization_id: ORG, name: "Pat Smithers" } },
      },
    ],
    job_photos: photos,
    social_posts: posts,
    job_requested_services: [{ job_id: "job-1", service_type_id: "mulch" }],
    services: [{ service_type_id: "mulch", name: "Mulching", organization_id: ORG }],
    social_cadence: [],
  } as Record<string, Row[]>;
}

const photo = (id: string, kind: string, at: string, zone = "z1") => ({ id, job_id: "job-1", kind, zone_id: zone, zone_name: "Front beds", created_at: at });

describe("draft from a backlog photo", () => {
  it("makes a draft waiting for approval, linked to the photo, with a caption and a suggested time", async () => {
    const db = fakeDb({ organizations: [{ id: ORG, name: "JS Landscaping", business_phone: null }], social_posts: [], social_photo_backlog: [{ id: "bp-1" }] });
    const made = await makeBacklogDraft(db.client, ORG, { id: "bp-1", town: "Fallston", service: "Fall cleanup", note: "Leaves cleared, beds cut back." }, { bookingUrl: BOOK, now: NOW });
    expect("postId" in made).toBe(true);
    const post = db.inserts.find((i) => i.table === "social_posts")!.row;
    expect(post.status).toBe("draft");
    expect(post.approved_at).toBeNull();
    expect(post.backlog_photo_id).toBe("bp-1");
    expect(post.auto_source).toBe("photo_backlog");
    expect(post.card_style).toBe("photo");
    expect(String(post.caption)).toContain("Fallston");
    expect(String(post.caption)).toContain(BOOK);
    expect(Date.parse(String(post.scheduled_for))).toBeGreaterThan(NOW.getTime());
    expect(post.plan_day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The backlog row points back at its draft.
    expect(db.updates.find((u) => u.table === "social_photo_backlog")?.values.social_post_id).toBe((made as { postId: string }).postId);
  });

  it("drops a note that names a price or claims a licence", async () => {
    const db = fakeDb({ organizations: [{ id: ORG }], social_posts: [], social_photo_backlog: [] });
    await makeBacklogDraft(db.client, ORG, { id: "bp-2", town: "Bel Air", service: null, note: "Only $300, fully licensed and insured" }, { bookingUrl: BOOK, now: NOW });
    const caption = String(db.inserts[0].row.caption);
    expect(caption).not.toMatch(/\$300|licensed|insured/i);
  });

  it("uses the AI writer when it answers, and the template when it writes something it shouldn't", async () => {
    const good = fakeDb({ organizations: [{ id: ORG }], social_posts: [] });
    await makeBacklogDraft(good.client, ORG, { id: "bp-3", town: "Bel Air", service: "Mulching", note: null }, {
      bookingUrl: BOOK,
      now: NOW,
      writer: async () => ({ hook: "Fresh mulch in Bel Air.", body: "Beds edged and topped up.", cta: `Book: ${BOOK}`, hashtags: ["#Mulch", "#BelAir", "#HarfordCounty"] }),
    });
    expect(good.inserts[0].row.hook).toBe("Fresh mulch in Bel Air.");

    const bad = fakeDb({ organizations: [{ id: ORG }], social_posts: [] });
    await makeBacklogDraft(bad.client, ORG, { id: "bp-4", town: "Bel Air", service: "Mulching", note: null }, {
      bookingUrl: BOOK,
      now: NOW,
      writer: async () => ({ hook: "Mulch from $99!", body: "Licensed and insured crew.", cta: "Call", hashtags: ["#a", "#b", "#c"] }),
    });
    expect(String(bad.inserts[0].row.caption)).not.toMatch(/\$99|licensed/i);
  });
});

describe("draft from a finished job's crew photos", () => {
  it("uses the before and after pair when there is one", async () => {
    const db = fakeDb(jobTables([photo("b1", "before", "2026-11-10T13:00:00Z"), photo("a1", "after", "2026-11-10T17:00:00Z")]));
    const result = await makeJobDraft(db.client, ORG, "job-1", { bookingUrl: BOOK, now: NOW });
    expect(result).toMatchObject({ made: true, shape: "pair" });
    const post = db.inserts[0].row;
    expect(post).toMatchObject({ status: "draft", job_id: "job-1", before_photo_id: "b1", after_photo_id: "a1", card_style: "split", auto_source: "crew_photos", approved_at: null });
    const caption = String(post.caption);
    expect(caption).toContain("Bel Air");
    expect(caption).toContain("Mulching");
    // Town only: never the street or the client.
    expect(caption).not.toMatch(/Oak Lane|12 Oak|Smithers|Pat\b/);
    expect(draftProblems({ hook: String(post.hook), body: String(post.body), cta: String(post.cta), hashtags: post.hashtags as string[] })).toEqual([]);
  });

  it("uses the best after photo alone when there is no pair", async () => {
    const db = fakeDb(jobTables([photo("a1", "after", "2026-11-10T15:00:00Z"), photo("a2", "after", "2026-11-10T17:00:00Z", "z2")]));
    const result = await makeJobDraft(db.client, ORG, "job-1", { bookingUrl: BOOK, now: NOW });
    expect(result).toMatchObject({ made: true, shape: "single" });
    const post = db.inserts[0].row;
    expect(post).toMatchObject({ before_photo_id: null, after_photo_id: "a2", card_style: "photo", status: "draft" });
    expect(String(post.caption)).not.toMatch(/Swipe for the before/);
  });

  it("makes nothing without an after photo", async () => {
    const db = fakeDb(jobTables([photo("b1", "before", "2026-11-10T13:00:00Z")]));
    expect(await makeJobDraft(db.client, ORG, "job-1", { bookingUrl: BOOK, now: NOW })).toMatchObject({ made: false });
    expect(db.inserts).toHaveLength(0);
  });

  it("is once per job: a second run, the catch-up, or a job the autopilot already posted make nothing more", async () => {
    const db = fakeDb(jobTables([photo("b1", "before", "2026-11-10T13:00:00Z"), photo("a1", "after", "2026-11-10T17:00:00Z")]), { uniqueJobDrafts: true });
    expect((await makeJobDraft(db.client, ORG, "job-1", { bookingUrl: BOOK, now: NOW })).made).toBe(true);
    expect((await makeJobDraft(db.client, ORG, "job-1", { bookingUrl: BOOK, now: NOW })).made).toBe(false);
    expect(await catchUpJobDrafts(db.client, ORG, { bookingUrl: BOOK, now: NOW })).toBe(0);
    expect(db.inserts).toHaveLength(1);

    const already = fakeDb(jobTables([photo("a1", "after", "2026-11-10T17:00:00Z")], [{ id: "p0", job_id: "job-1", auto_source: "crew_photos", status: "scheduled" }]));
    expect(await catchUpJobDrafts(already.client, ORG, { bookingUrl: BOOK, now: NOW })).toBe(0);
    expect(already.inserts).toHaveLength(0);
  });

  it("the catch-up makes the draft for a finished job with none", async () => {
    const db = fakeDb(jobTables([photo("a1", "after", "2026-11-10T17:00:00Z")]));
    expect(await catchUpJobDrafts(db.client, ORG, { bookingUrl: BOOK, now: NOW })).toBe(1);
    expect(db.inserts[0].row).toMatchObject({ job_id: "job-1", status: "draft" });
  });

  it("won't draft another business's job", async () => {
    const db = fakeDb(jobTables([photo("a1", "after", "2026-11-10T17:00:00Z")]));
    expect(await makeJobDraft(db.client, "org-2", "job-1", { bookingUrl: BOOK, now: NOW })).toMatchObject({ made: false });
  });
});

describe("the marketing autopilot", () => {
  it("now makes drafts that wait for approval instead of scheduled, pre-approved posts", async () => {
    const tables = jobTables([photo("b1", "before", "2026-11-10T13:00:00Z"), photo("a1", "after", "2026-11-10T17:00:00Z")]);
    tables.jobs[0].photos_approved_at = "2026-11-12T12:00:00Z";
    const db = fakeDb(tables);
    const settings = { ...DEFAULT_AUTOPILOT, enabled: { ...DEFAULT_AUTOPILOT.enabled, social_autopost: true, social_reslot: false } };
    const result = await runSocialAutopilot(db.client, ORG, { settings, started: { social_autopost: "2026-11-01T00:00:00Z" } }, NOW, BOOK);
    expect(result.made).toBe(1);
    const post = db.inserts[0].row;
    expect(post.status).toBe("draft");
    expect(post.approved_at).toBeNull();
    expect(post.auto_source).toBe("crew_photos");
    expect(post.scheduled_for).toBeTruthy(); // a suggestion, kept on approval
    expect(String(post.caption)).not.toMatch(/Oak Lane|Smithers/);
  });
});
