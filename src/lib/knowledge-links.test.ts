import { describe, expect, it } from "vitest";

import {
  APP_DESTINATIONS,
  destinationFor,
  safeAppRoute,
  suggestDestination,
} from "@/lib/knowledge-links";

describe("app destinations", () => {
  it("knows a route it lists", () => {
    expect(destinationFor("/admin/flyer")?.label).toBe("Flyer design");
  });

  it("says nothing for a route it does not list", () => {
    // A node whose link 404s is worse than a node with no link.
    expect(destinationFor("/made/up")).toBeNull();
    expect(destinationFor(null)).toBeNull();
  });

  it("has no duplicate routes", () => {
    const routes = APP_DESTINATIONS.map((d) => d.route);
    expect(new Set(routes).size).toBe(routes.length);
  });
});

describe("suggesting a destination", () => {
  it("points a flyer at the flyer designer", () => {
    expect(suggestDestination("EDDM flyer run")?.route).toBe("/admin/flyer");
    expect(suggestDestination("Door hanger campaign")?.route).toBe("/admin/flyer");
  });

  it("points social media at the post queue", () => {
    expect(suggestDestination("Social media")?.route).toBe("/admin/social");
    expect(suggestDestination("Instagram before and after")?.route).toBe("/admin/social");
  });

  it("prefers the flyer when a node names both", () => {
    // "Flyer" is the more specific thing on the node, and a flyer post is
    // still made in the flyer designer.
    expect(suggestDestination("Flyer post on Facebook")?.route).toBe("/admin/flyer");
  });

  it("guesses nothing rather than guessing wrong", () => {
    expect(suggestDestination("Buy a new trailer")).toBeNull();
    expect(suggestDestination("")).toBeNull();
  });
});

describe("what gets stored", () => {
  it("keeps a route we have", () => {
    expect(safeAppRoute("/admin/social")).toBe("/admin/social");
  });

  it("drops a route we do not, rather than storing a dead link", () => {
    expect(safeAppRoute("/admin/nope")).toBeNull();
    expect(safeAppRoute("https://example.com")).toBeNull();
    expect(safeAppRoute("")).toBeNull();
    expect(safeAppRoute(null)).toBeNull();
  });
});
