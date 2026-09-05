/**
 * Why a notification did or did not go out.
 *
 * Every reason a text is skipped was a bare `return false`: no credentials,
 * no preferences row, the kind switched off, no phone number. All of them
 * silent, none of them recorded, and all of them looking identical from the
 * outside — which is to say, looking like nothing happened at all. Somebody
 * asking "why did nobody get a message" had no way to find out.
 *
 * So the decision is made here, once, and it answers with a reason. The
 * caller sends or records the reason, and the reason is a sentence a person
 * can act on.
 */

export type NotificationKind =
  | "appointment_reminders"
  | "client_messages"
  | "proposal_responses"
  | "team_messages"
  | "walkthrough_requests";

export interface NotificationPrefs {
  sms_enabled?: boolean | null;
  appointment_reminders?: boolean | null;
  client_messages?: boolean | null;
  proposal_responses?: boolean | null;
  team_messages?: boolean | null;
  walkthrough_requests?: boolean | null;
}

export type GateVerdict =
  | { send: true }
  | { send: false; reason: SkipReason; detail: string };

export type SkipReason =
  | "no_sms_provider"
  | "muted"
  | "kind_off"
  | "no_phone"
  | "unreadable_phone";

/**
 * What somebody gets when they have never opened the notification settings.
 *
 * The table's own defaults are the wrong way round for a working business:
 * `sms_enabled` defaults to false, so a row created by any means leaves that
 * person silent until they find a settings screen and turn it on. Nobody had
 * a row at all, so nobody on the team could be notified about anything, ever,
 * and nothing said so.
 *
 * A person who has expressed no preference is treated as wanting the things
 * that need a human now -- a client wrote in, a proposal came back, a
 * walkthrough was asked for, an appointment is coming. Chatter between
 * teammates stays off by default, because that is the one that becomes noise
 * and the one people turn off first.
 *
 * Anybody who has saved a preference gets exactly what they saved.
 */
export const DEFAULTS: Required<NotificationPrefs> = {
  sms_enabled: true,
  appointment_reminders: true,
  client_messages: true,
  proposal_responses: true,
  walkthrough_requests: true,
  team_messages: false,
};

/** A stored row, filled in from the defaults wherever it says nothing. */
export function effectivePrefs(prefs: NotificationPrefs | null | undefined): Required<NotificationPrefs> {
  if (!prefs) return { ...DEFAULTS };
  return {
    sms_enabled: prefs.sms_enabled ?? DEFAULTS.sms_enabled,
    appointment_reminders: prefs.appointment_reminders ?? DEFAULTS.appointment_reminders,
    client_messages: prefs.client_messages ?? DEFAULTS.client_messages,
    proposal_responses: prefs.proposal_responses ?? DEFAULTS.proposal_responses,
    team_messages: prefs.team_messages ?? DEFAULTS.team_messages,
    walkthrough_requests: prefs.walkthrough_requests ?? DEFAULTS.walkthrough_requests,
  };
}

/**
 * Whether this notification should go, and if not, why not.
 *
 * `overridesKind` is for somebody who opted into one specific thing — a group
 * they joined — so the general per-kind switch should not veto it. The master
 * switch and a usable phone number still apply: those are "do not text me"
 * and "there is nowhere to text", and neither is overridable by wanting it.
 */
export function notificationGate(input: {
  smsConfigured: boolean;
  prefs: NotificationPrefs | null | undefined;
  /** Whether a row existed at all, which changes what the reason should say. */
  hasStoredPrefs?: boolean;
  phone: string | null | undefined;
  toE164: (phone: string) => string | null;
  kind: NotificationKind;
  overridesKind?: boolean;
}): GateVerdict {
  if (!input.smsConfigured) {
    return {
      send: false,
      reason: "no_sms_provider",
      detail:
        "No text provider is set up. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER, then redeploy.",
    };
  }

  const prefs = effectivePrefs(input.prefs);

  if (!prefs.sms_enabled) {
    return {
      send: false,
      reason: "muted",
      detail: "They have turned text notifications off in their settings.",
    };
  }

  if (!prefs[input.kind] && !input.overridesKind) {
    return {
      send: false,
      reason: "kind_off",
      detail: input.hasStoredPrefs
        ? `They have "${label(input.kind)}" switched off.`
        : `"${label(input.kind)}" is off unless somebody turns it on.`,
    };
  }

  const phone = (input.phone ?? "").trim();
  if (!phone) {
    return {
      send: false,
      reason: "no_phone",
      detail: "No phone number on their profile, so there is nowhere to send it.",
    };
  }

  if (!input.toE164(phone)) {
    return {
      send: false,
      reason: "unreadable_phone",
      detail: `"${phone}" is not a phone number this can dial. It needs ten digits, or a leading +.`,
    };
  }

  return { send: true };
}

const LABELS: Record<NotificationKind, string> = {
  appointment_reminders: "Appointment reminders",
  client_messages: "Client messages",
  proposal_responses: "Proposal responses",
  team_messages: "Team messages",
  walkthrough_requests: "Walkthrough requests",
};

export function label(kind: NotificationKind): string {
  return LABELS[kind] ?? kind;
}
