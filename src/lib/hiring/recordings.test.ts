import { describe, expect, it } from "vitest";

import { callNeededToMove, isRecordingPathFor, recordingExt, recordingNotice, recordingPrefix, stepNeedsRecording } from "@/lib/hiring/recordings";

const ORG = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const FILE = "33333333-3333-4333-8333-333333333333";

describe("recorded hiring calls", () => {
  it("keeps each recording under its business and person", () => {
    expect(recordingPrefix(ORG, "newhire", ID)).toBe(`${ORG}/newhire/${ID}/`);
    expect(isRecordingPathFor(`${ORG}/newhire/${ID}/${FILE}.webm`, ORG, "newhire", ID)).toBe(true);
    expect(isRecordingPathFor(`${ORG}/applicant/${ID}/${FILE}.webm`, ORG, "newhire", ID)).toBe(false);
    expect(isRecordingPathFor(`${ORG}/newhire/${ID}/../x/${FILE}.webm`, ORG, "newhire", ID)).toBe(false);
    expect(isRecordingPathFor(`${ORG}/newhire/${ID}/${FILE}.exe`, ORG, "newhire", ID)).toBe(false);
  });

  it("takes the audio formats browsers record", () => {
    expect(recordingExt("audio/webm;codecs=opus")).toBe("webm");
    expect(recordingExt("audio/mp4")).toBe("m4a");
    expect(recordingExt("image/png")).toBeNull();
  });

  it("holds the next step until the interview call is recorded, never a no", () => {
    expect(callNeededToMove("interview", "working_interview")).toBe("interview");
    expect(callNeededToMove("interview", "owner_talk")).toBe("interview");
    expect(callNeededToMove("owner_talk", "offer_sent")).toBe("owner_talk");
    expect(callNeededToMove("interview", "not_a_fit")).toBeNull();
    expect(callNeededToMove("owner_talk", "withdrawn")).toBeNull();
  });

  it("logs check-ins and reviews only with a recording", () => {
    expect(stepNeedsRecording("checkin")).toBe(true);
    expect(stepNeedsRecording("review")).toBe(true);
    expect(stepNeedsRecording("training")).toBe(false);
  });

  it("tells them in writing that calls are recorded", () => {
    expect(recordingNotice("JS Landscaping MD")).toBe("Interviews, calls and check-ins with JS Landscaping MD are recorded for training and quality.");
  });
});
