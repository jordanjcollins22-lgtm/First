import { describe, expect, it } from "vitest";

import {
  applyOrder,
  blockReason,
  clientNotice,
  DEFAULT_RAIN_RULES,
  needsApproval,
  planCascade,
  rainRulesFrom,
  rescheduleDedupeKey,
  workTypeFor,
  type CascadeSession,
  type DayWeather,
} from "@/lib/weather-cascade/rules";

// 2026-10-12 is a Monday.
const MON = "2026-10-12";
const TUE = "2026-10-13";
const WED = "2026-10-14";
const THU = "2026-10-15";
const FRI = "2026-10-16";
const MON2 = "2026-10-19";

function dry(date: string): DayWeather {
  return { date, rainIn: 0, rainChance: 10, snowIn: 0, code: 1, tempMinF: 50, tempMaxF: 65 };
}
function wet(date: string, rainIn = 0.6, rainChance = 80): DayWeather {
  return { date, rainIn, rainChance, snowIn: 0, code: 63, tempMinF: 50, tempMaxF: 60 };
}
function weekOf(days: DayWeather[]): Map<string, DayWeather> {
  return new Map(days.map((d) => [d.date, d]));
}
function session(id: string, start: string, over: Partial<CascadeSession> = {}): CascadeSession {
  return { id, jobId: `job-${id}`, chainKey: "lead-a", startsOn: start, endsOn: start, workType: "mowing", locationKey: "home", movable: true, ...over };
}

describe("workTypeFor", () => {
  it("reads the kind of work from the services, strictest first", () => {
    expect(workTypeFor(["lawn-mowing"])).toBe("mowing");
    expect(workTypeFor(["paver_patio", "lawn-mowing"])).toBe("install");
    expect(workTypeFor(["salting"])).toBe("snow");
    expect(workTypeFor(["walkthrough"])).toBe("other");
  });
  it("matches whole words, so 'service' is not ice", () => {
    expect(workTypeFor(["lawn-service"])).toBe("other");
  });
  it("takes the order tables' word for it", () => {
    expect(workTypeFor([], { mowOrder: true })).toBe("mowing");
    expect(workTypeFor([], { saltOrder: true })).toBe("snow");
  });
});

describe("blockReason", () => {
  const rules = DEFAULT_RAIN_RULES;
  it("stops mowing at the rain limit when rain is likely", () => {
    expect(blockReason("mowing", MON, weekOf([wet(MON, 0.3)]), rules)).toMatch(/0.3 in of rain/);
    expect(blockReason("mowing", MON, weekOf([wet(MON, 0.2)]), rules)).toBeNull();
  });
  it("ignores rain that probably won't come", () => {
    expect(blockReason("mowing", MON, weekOf([wet(MON, 0.8, 30)]), rules)).toBeNull();
  });
  it("holds installs to a lower limit than mowing", () => {
    const w = weekOf([wet(MON, 0.22)]);
    expect(blockReason("mowing", MON, w, rules)).toBeNull();
    expect(blockReason("install", MON, w, rules)).not.toBeNull();
  });
  it("keeps crews off saturated ground the day after heavy rain", () => {
    const w = weekOf([wet(MON, 1.4, 90), dry(TUE), dry(WED)]);
    expect(blockReason("mowing", TUE, w, rules)).toMatch(/saturated/);
    expect(blockReason("mowing", WED, w, rules)).toBeNull();
    expect(blockReason("mowing", WED, w, { ...rules, saturatedDays: 2 })).toMatch(/saturated/);
  });
  it("never moves snow work or other work for rain", () => {
    const w = weekOf([wet(MON, 2)]);
    expect(blockReason("snow", MON, w, rules)).toBeNull();
    expect(blockReason("other", MON, w, rules)).toBeNull();
  });
  it("treats a day with no forecast as workable", () => {
    expect(blockReason("mowing", MON, new Map(), rules)).toBeNull();
  });
  it("stops ground work for snow", () => {
    const w = weekOf([{ ...dry(MON), snowIn: 1, tempMinF: 28 }]);
    expect(blockReason("install", MON, w, rules)).toMatch(/snow/);
  });
});

describe("rainRulesFrom", () => {
  it("falls back to the defaults for missing or nonsense values", () => {
    expect(rainRulesFrom(null)).toEqual(DEFAULT_RAIN_RULES);
    expect(rainRulesFrom({ mow_rain_in: "0.4", install_rain_in: -1, saturated_days: 9 })).toMatchObject({
      mowRainIn: 0.4,
      installRainIn: DEFAULT_RAIN_RULES.installRainIn,
      saturatedDays: 3,
    });
  });
});

describe("planCascade", () => {
  const base = { rules: DEFAULT_RAIN_RULES, workWeekdays: [1, 2, 3, 4, 5], today: MON };

  it("slides the whole chain when Monday is rained out", () => {
    const plan = planCascade({
      ...base,
      sessions: [session("a", MON), session("b", TUE), session("c", WED), session("e", FRI)],
      weatherByLocation: new Map([["home", weekOf([wet(MON, 0.5), dry(TUE), dry(WED), dry(THU), dry(FRI)])]]),
    });
    const moved = Object.fromEntries(plan.moves.map((m) => [m.sessionId, m.toStart]));
    // Mon → Tue, Tue → Wed, Wed → Thu; Friday was free of collision and stays.
    expect(moved).toEqual({ a: TUE, b: WED, c: THU });
    expect(plan.moves.find((m) => m.sessionId === "a")?.cause).toBe("weather");
    expect(plan.moves.find((m) => m.sessionId === "b")?.cause).toBe("chain");
    expect(plan.stuck).toEqual([]);
  });

  it("moves a crew's whole day together, however many stops are on it", () => {
    const plan = planCascade({
      ...base,
      sessions: [session("a1", MON), session("a2", MON), session("a3", MON)],
      weatherByLocation: new Map([["home", weekOf([wet(MON)])]]),
    });
    expect(plan.moves.map((m) => m.toStart)).toEqual([TUE, TUE, TUE]);
  });

  it("skips a day that is also wet, and weekends", () => {
    const plan = planCascade({
      ...base,
      today: THU,
      sessions: [session("a", THU)],
      weatherByLocation: new Map([["home", weekOf([wet(THU), wet(FRI)])]]),
    });
    expect(plan.moves[0].toStart).toBe(MON2);
    expect(plan.moves[0].shiftDays).toBe(4);
  });

  it("does not touch a crew whose days are dry", () => {
    const plan = planCascade({
      ...base,
      sessions: [session("a", MON, { chainKey: "lead-b", locationKey: "far" }), session("x", MON)],
      weatherByLocation: new Map([
        ["home", weekOf([wet(MON)])],
        ["far", weekOf([dry(MON)])],
      ]),
    });
    expect(plan.moves.map((m) => m.sessionId)).toEqual(["x"]);
  });

  it("leaves fixed visits where they are and lands around them", () => {
    const plan = planCascade({
      ...base,
      sessions: [session("a", MON), session("locked", TUE, { movable: false })],
      weatherByLocation: new Map([["home", weekOf([wet(MON)])]]),
    });
    expect(plan.moves).toHaveLength(1);
    expect(plan.moves[0].toStart).toBe(WED);
  });

  it("never moves other work for rain, but moves it along when the chain lands on it", () => {
    const plan = planCascade({
      ...base,
      sessions: [session("a", MON), session("walk", TUE, { workType: "other" })],
      weatherByLocation: new Map([["home", weekOf([wet(MON), wet(TUE, 0.1, 90)])]]),
    });
    expect(Object.fromEntries(plan.moves.map((m) => [m.sessionId, m.toStart]))).toEqual({ a: TUE, walk: WED });
  });

  it("keeps a multi-day job's length and needs every day of it workable", () => {
    const plan = planCascade({
      ...base,
      sessions: [session("patio", MON, { endsOn: TUE, workType: "install" })],
      weatherByLocation: new Map([["home", weekOf([dry(MON), wet(TUE), dry(WED), dry(THU)])]]),
    });
    expect(plan.moves[0]).toMatchObject({ toStart: WED, toEnd: THU });
  });

  it("says when there is nowhere to go", () => {
    const allWet = Array.from({ length: 30 }, (_, i) => wet(new Date(Date.parse(`${MON}T12:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10)));
    const plan = planCascade({ ...base, sessions: [session("a", MON)], weatherByLocation: new Map([["home", weekOf(allWet)]]), maxSearchDays: 5 });
    expect(plan.moves).toEqual([]);
    expect(plan.stuck[0].sessionId).toBe("a");
  });

  it("ignores visits already in the past", () => {
    const plan = planCascade({ ...base, today: WED, sessions: [session("old", MON)], weatherByLocation: new Map([["home", weekOf([wet(MON)])]]) });
    expect(plan.moves).toEqual([]);
  });
});

describe("needsApproval", () => {
  const limits = { autoApply: true, maxShiftDays: 3, maxMoves: 10 };
  const move = (shiftDays: number) => ({ shiftDays }) as never;
  it("lets small moves through", () => {
    expect(needsApproval([move(1), move(2)], limits)).toBeNull();
  });
  it("holds a move further than the limit", () => {
    expect(needsApproval([move(4)], limits)).toMatch(/4 days/);
  });
  it("holds a run that would move too many visits", () => {
    expect(needsApproval([move(1), move(1)], limits, 9)).toMatch(/More than 10/);
  });
  it("holds everything when auto-apply is off", () => {
    expect(needsApproval([move(1)], { ...limits, autoApply: false })).toMatch(/switched off/);
  });
});

describe("applyOrder", () => {
  it("writes the latest landing first so no day is ever double-booked on the way", () => {
    const order = applyOrder([
      { toStart: TUE, fromStart: MON },
      { toStart: THU, fromStart: WED },
      { toStart: WED, fromStart: TUE },
    ]);
    expect(order.map((m) => m.toStart)).toEqual([THU, WED, TUE]);
  });
});

describe("client notice", () => {
  it("says what moved and why in one text", () => {
    const text = clientNotice({ firstName: "Ann", business: "JS Landscaping", fromStart: MON, toStart: TUE, cause: "weather" });
    expect(text).toContain("Hi Ann");
    expect(text).toContain("Monday, Oct 12");
    expect(text).toContain("Tuesday, Oct 13");
    expect(text).toContain("weather");
  });
  it("has a stable dedupe key per move and channel", () => {
    expect(rescheduleDedupeKey("s1", MON, TUE, "sms")).toBe(rescheduleDedupeKey("s1", MON, TUE, "sms"));
    expect(rescheduleDedupeKey("s1", MON, TUE, "sms")).not.toBe(rescheduleDedupeKey("s1", MON, WED, "sms"));
  });
});
