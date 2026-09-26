import { describe, expect, it } from "vitest";

import {
  DEFAULT_RULES,
  dedupeKeyFor,
  describeOffset,
  dueFor,
  dueNow,
  KIND_LABEL,
  KIND_WHY,
  mergeRules,
  type ReminderRule,
  type ReminderSubject,
} from "@/lib/client-reminders";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-03-10T15:00:00Z");

function subject(over: Partial<ReminderSubject> = {}): ReminderSubject {
  return {
    kind: "evaluation_reminder",
    referenceId: "job-1",
    customerId: "cust-1",
    anchor: new Date(NOW.getTime() + 24 * HOUR),
    settled: false,
    ...over,
  };
}

const REMIND_A_DAY_BEFORE: ReminderRule[] = [
  { kind: "evaluation_reminder", enabled: true, channels: ["sms"], offsetsHours: [-18] },
];

describe("the reminders a business gets before it changes anything", () => {
  it("covers the five moments a client actually hears from us", () => {
    expect(DEFAULT_RULES.map((rule) => rule.kind).sort()).toEqual([
      "evaluation_confirmed",
      "evaluation_reminder",
      "invoice_reminder",
      "job_start_reminder",
      "proposal_follow_up",
    ]);
  });

  it("is quiet: no rule fires more than twice", () => {
    // Two touches is a business on top of things. Five is one somebody mutes.
    for (const rule of DEFAULT_RULES) expect(rule.offsetsHours.length).toBeLessThanOrEqual(2);
  });

  it("names and explains every one of them", () => {
    for (const rule of DEFAULT_RULES) {
      expect(KIND_LABEL[rule.kind].length).toBeGreaterThan(0);
      expect(KIND_WHY[rule.kind].length).toBeGreaterThan(0);
    }
  });

  it("gives every rule somewhere to send", () => {
    for (const rule of DEFAULT_RULES) expect(rule.channels.length).toBeGreaterThan(0);
  });
});

describe("whether one reminder is due", () => {
  it("is not due before its moment", () => {
    // The appointment is a day away and the rule fires 18 hours before it,
    // which is six hours from now.
    expect(dueFor(subject(), REMIND_A_DAY_BEFORE, NOW)).toEqual([]);
  });

  it("is due once its moment has passed", () => {
    const due = dueFor(subject({ anchor: new Date(NOW.getTime() + 17 * HOUR) }), REMIND_A_DAY_BEFORE, NOW);
    expect(due).toHaveLength(1);
    expect(due[0].channel).toBe("sms");
    expect(due[0].offsetHours).toBe(-18);
  });

  it("lets a badly late one go rather than sending it", () => {
    // A reminder for an appointment that was yesterday is not a reminder, it
    // is a confusing text. The cron may have been down; catching up is worse.
    const past = subject({ anchor: new Date(NOW.getTime() - 48 * HOUR) });
    expect(dueFor(past, REMIND_A_DAY_BEFORE, NOW)).toEqual([]);
  });

  it("sends a late confirmation anyway, because it is still welcome", () => {
    const rules: ReminderRule[] = [
      { kind: "evaluation_confirmed", enabled: true, channels: ["email"], offsetsHours: [0] },
    ];
    const old = subject({ kind: "evaluation_confirmed", anchor: new Date(NOW.getTime() - 200 * HOUR) });
    expect(dueFor(old, rules, NOW)).toHaveLength(1);
  });

  it("says nothing about something already dealt with", () => {
    const done = subject({ anchor: new Date(NOW.getTime() + 17 * HOUR), settled: true });
    expect(dueFor(done, REMIND_A_DAY_BEFORE, NOW)).toEqual([]);
  });

  it("says nothing when the rule is switched off", () => {
    const off: ReminderRule[] = [{ ...REMIND_A_DAY_BEFORE[0], enabled: false }];
    expect(dueFor(subject({ anchor: new Date(NOW.getTime() + 17 * HOUR) }), off, NOW)).toEqual([]);
  });

  it("says nothing when there is no rule for this kind at all", () => {
    expect(dueFor(subject({ kind: "invoice_reminder" }), REMIND_A_DAY_BEFORE, NOW)).toEqual([]);
  });

  it("gives one for each channel the rule sends on", () => {
    const both: ReminderRule[] = [{ ...REMIND_A_DAY_BEFORE[0], channels: ["sms", "email"] }];
    const due = dueFor(subject({ anchor: new Date(NOW.getTime() + 17 * HOUR) }), both, NOW);
    expect(due.map((d) => d.channel).sort()).toEqual(["email", "sms"]);
  });

  it("gives one for each time a follow-up fires", () => {
    const twice: ReminderRule[] = [
      { kind: "proposal_follow_up", enabled: true, channels: ["email"], offsetsHours: [72, 168] },
    ];
    const sent = subject({ kind: "proposal_follow_up", anchor: new Date(NOW.getTime() - 200 * HOUR) });
    // Both moments have passed, and both are more than a day late, so both
    // are let go rather than arriving together.
    expect(dueFor(sent, twice, NOW)).toEqual([]);

    const recent = subject({ kind: "proposal_follow_up", anchor: new Date(NOW.getTime() - 73 * HOUR) });
    expect(dueFor(recent, twice, NOW)).toHaveLength(1);
  });
});

describe("what makes a send unique", () => {
  it("is the thing, the moment and the channel", () => {
    expect(dedupeKeyFor("evaluation_reminder", "job-1", -18, "sms")).toBe(
      "evaluation_reminder:job-1:-18:sms"
    );
  });

  it("tells the two halves of a follow-up apart", () => {
    expect(dedupeKeyFor("proposal_follow_up", "p1", 72, "email")).not.toBe(
      dedupeKeyFor("proposal_follow_up", "p1", 168, "email")
    );
  });

  it("tells a text apart from an email about the same thing", () => {
    expect(dedupeKeyFor("evaluation_reminder", "j1", -18, "sms")).not.toBe(
      dedupeKeyFor("evaluation_reminder", "j1", -18, "email")
    );
  });
});

describe("the whole list, due now", () => {
  const ready = [
    subject({ referenceId: "job-1", anchor: new Date(NOW.getTime() + 17 * HOUR) }),
    subject({ referenceId: "job-2", anchor: new Date(NOW.getTime() + 17 * HOUR) }),
  ];

  it("gathers every reminder that is due", () => {
    expect(dueNow(ready, REMIND_A_DAY_BEFORE, new Set(), NOW)).toHaveLength(2);
  });

  it("leaves out the ones already sent", () => {
    // The log is the memory, and it is what makes a cron safe to run twice.
    const sent = new Set([dedupeKeyFor("evaluation_reminder", "job-1", -18, "sms")]);
    const due = dueNow(ready, REMIND_A_DAY_BEFORE, sent, NOW);
    expect(due.map((d) => d.referenceId)).toEqual(["job-2"]);
  });

  it("is empty when everything has gone already", () => {
    const sent = new Set(ready.map((s) => dedupeKeyFor("evaluation_reminder", s.referenceId, -18, "sms")));
    expect(dueNow(ready, REMIND_A_DAY_BEFORE, sent, NOW)).toEqual([]);
  });

  it("is empty when there is nothing to remind anybody about", () => {
    expect(dueNow([], DEFAULT_RULES, new Set(), NOW)).toEqual([]);
  });
});

describe("settings merged onto the defaults", () => {
  it("gives a business that has never touched them the defaults", () => {
    expect(mergeRules([])).toEqual(DEFAULT_RULES);
  });

  it("takes what was saved", () => {
    const merged = mergeRules([{ kind: "evaluation_reminder", enabled: false }]);
    expect(merged.find((r) => r.kind === "evaluation_reminder")?.enabled).toBe(false);
  });

  it("keeps the default for anything the saved row did not say", () => {
    const merged = mergeRules([{ kind: "evaluation_reminder", enabled: true }]);
    expect(merged.find((r) => r.kind === "evaluation_reminder")?.offsetsHours).toEqual([-18]);
  });

  it("switches a newly added kind on at its default rather than leaving it silent", () => {
    const merged = mergeRules([{ kind: "evaluation_reminder", enabled: false }]);
    expect(merged).toHaveLength(DEFAULT_RULES.length);
    expect(merged.find((r) => r.kind === "invoice_reminder")?.enabled).toBe(true);
  });
});

describe("how a rule's timing reads", () => {
  it("says it in days where it is days", () => {
    expect(describeOffset(-24)).toBe("1 day before");
    expect(describeOffset(72)).toBe("3 days after");
  });

  it("says it in hours where it is not", () => {
    expect(describeOffset(-18)).toBe("18 hours before");
    expect(describeOffset(1)).toBe("1 hour after");
  });

  it("says straight away for no offset at all", () => {
    expect(describeOffset(0)).toBe("straight away");
  });
});
