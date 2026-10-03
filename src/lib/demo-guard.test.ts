import { describe, expect, it } from "vitest";

import { cookieSaysDemo, demoBlocks } from "./demo-guard";

const DB = "https://project.supabase.co";

describe("the demo lets reading through and nothing else", () => {
  it("reads the tables and refuses changing them", () => {
    expect(demoBlocks(`${DB}/rest/v1/jobs?select=*`, "GET")).toBe(false);
    expect(demoBlocks(`${DB}/rest/v1/jobs?select=*`, "HEAD")).toBe(false);
    expect(demoBlocks(`${DB}/rest/v1/jobs`, "POST")).toBe(true);
    expect(demoBlocks(`${DB}/rest/v1/jobs?id=eq.1`, "PATCH")).toBe(true);
    expect(demoBlocks(`${DB}/rest/v1/jobs?id=eq.1`, "DELETE")).toBe(true);
  });

  it("runs the functions that only read, and refuses the rest, new ones included", () => {
    expect(demoBlocks(`${DB}/rest/v1/rpc/summary_get`, "POST")).toBe(false);
    expect(demoBlocks(`${DB}/rest/v1/rpc/houses_in_bbox`, "POST")).toBe(false);
    expect(demoBlocks(`${DB}/rest/v1/rpc/delete_job`, "POST")).toBe(true);
    expect(demoBlocks(`${DB}/rest/v1/rpc/zone_build`, "POST")).toBe(true);
    expect(demoBlocks(`${DB}/rest/v1/rpc/something_new`, "POST")).toBe(true);
  });

  it("shows photos, and refuses uploading, replacing or deleting them", () => {
    expect(demoBlocks(`${DB}/storage/v1/object/public/tool-images/a.jpg`, "GET")).toBe(false);
    expect(demoBlocks(`${DB}/storage/v1/object/list/job-photos`, "POST")).toBe(false);
    expect(demoBlocks(`${DB}/storage/v1/object/sign/job-photos/a.jpg`, "POST")).toBe(false);
    expect(demoBlocks(`${DB}/storage/v1/object/job-photos/a.jpg`, "POST")).toBe(true);
    expect(demoBlocks(`${DB}/storage/v1/object/job-photos/a.jpg`, "PUT")).toBe(true);
    expect(demoBlocks(`${DB}/storage/v1/object/job-photos`, "DELETE")).toBe(true);
  });

  it("keeps you signed in, and refuses changing accounts", () => {
    expect(demoBlocks(`${DB}/auth/v1/user`, "GET")).toBe(false);
    expect(demoBlocks(`${DB}/auth/v1/token?grant_type=refresh_token`, "POST")).toBe(false);
    expect(demoBlocks(`${DB}/auth/v1/user`, "PUT")).toBe(true);
    expect(demoBlocks(`${DB}/auth/v1/admin/users`, "POST")).toBe(true);
    expect(demoBlocks(`${DB}/auth/v1/invite`, "POST")).toBe(true);
    expect(demoBlocks(`${DB}/functions/v1/anything`, "POST")).toBe(true);
  });

  it("knows a demo from its cookie", () => {
    expect(cookieSaysDemo("a=b; js_demo=1; c=d")).toBe(true);
    expect(cookieSaysDemo("js_demo=0")).toBe(false);
    expect(cookieSaysDemo(null)).toBe(false);
  });
});
