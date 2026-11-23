import { describe, expect, it } from "vitest";

import { crewPath, crewZoneLabel, jobIdFromCrewToken } from "./crew-link";

describe("crew link", () => {
  const job = "4d4818ff-0fc5-462f-86ae-d33624807ffb";

  it("is the job's own id", () => {
    expect(crewPath(job)).toBe(`/crew/${job}`);
    expect(jobIdFromCrewToken(job)).toBe(job);
  });

  it("refuses anything that is not a job id", () => {
    expect(jobIdFromCrewToken("1")).toBeNull();
    expect(jobIdFromCrewToken("../jobs")).toBeNull();
    expect(jobIdFromCrewToken(`${job}x`)).toBeNull();
  });
});

describe("crewZoneLabel", () => {
  it("renumbers plain Zone N names to match the marker", () => {
    expect(crewZoneLabel("Zone 4", 3)).toBe("Zone 3");
    expect(crewZoneLabel("zone 5", 4)).toBe("Zone 4");
    expect(crewZoneLabel("", 2)).toBe("Zone 2");
  });
  it("keeps a real area name", () => {
    expect(crewZoneLabel("Front bed", 1)).toBe("Front bed");
  });
});
