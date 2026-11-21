import { describe, expect, it } from "vitest";

import { crewPath, jobIdFromCrewToken } from "./crew-link";

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
