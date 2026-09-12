function normalizeRole(role: string): string {
  return role.toLowerCase().replace(/[_\s]+/g, " ").trim();
}

export function isEvaluator(roles: string[]): boolean {
  return roles.some((r) => normalizeRole(r) === "evaluator");
}

/** Somebody who works jobs. Matched loosely, like every other role check here,
 * because role names are free text an org defines itself. */
export function isCrew(roles: string[]): boolean {
  return roles.some((r) => normalizeRole(r) === "crew");
}

export function isAccountManager(roles: string[]): boolean {
  return roles.some((r) => normalizeRole(r) === "account manager");
}

/**
 * Whose business the money is.
 *
 * The same three the database itself uses to gate the ledger, the payroll
 * and the overhead, so what the pulse shows and what the tables allow can
 * never drift apart. An account manager or an evaluator sees how the work
 * is going; the cash in the bank is not theirs to see.
 */
const MONEY_ROLES = ["admin", "owner", "overhead"];

export function canSeeMoney(roles: string[]): boolean {
  return roles.some((r) => MONEY_ROLES.includes(normalizeRole(r)));
}

/**
 * Who can be sent to do an evaluation.
 *
 * Both roles, because both do them -- that was the ask from the start: whoever
 * has availability gets it, an evaluator or an account manager. The public
 * booking page used to offer only the evaluator role's hours, so a business
 * whose evaluator had not filled in a week yet showed a client a calendar with
 * nothing on it, while an account manager sat there with five days free.
 *
 * Role names are free text an org defines itself, so this matches loosely:
 * "Evaluator", "evaluator", "Account Manager" and "account_manager" all count.
 */
export function canDoEvaluations(roles: string[], explicit?: boolean | null): boolean {
  // Somebody who has actually thought about it wins. Role names are free text
  // an organisation invents for itself, so they will never reliably answer
  // "can this person be sent to a house" -- the owner here does half the
  // evaluations and is only ever going to be called "admin", and a crew member
  // had one sitting on him for a month.
  if (explicit != null) return explicit;
  return isEvaluator(roles) || isAccountManager(roles);
}

/** The same two, and deliberately the same answer: somebody who can be booked
 * is somebody worth handing a link to. */
export function qualifiesForAffiliateLink(roles: string[]): boolean {
  return canDoEvaluations(roles);
}

/**
 * Roles that run the business rather than do the work.
 *
 * Anybody holding one of these needs the full app. Everybody else is in a
 * truck, and the full app is noise to them.
 */
const OFFICE_ROLES = ["admin", "owner", "overhead", "evaluator", "account manager", "manager"];

export function isOfficeRole(role: string): boolean {
  return OFFICE_ROLES.includes(normalizeRole(role));
}

/**
 * Whether this person only works in the field.
 *
 * Decides the landing screen and how much navigation to show. Deliberately
 * "holds no office role" rather than "holds the crew role": somebody given a
 * custom role like "Foreman" is still in a truck, and defaulting them into the
 * office view would be the wrong way to be wrong. Somebody with no roles at
 * all is not field-only — they are unconfigured, and quietly locking them to
 * one screen would hide the fact that nobody has set them up.
 */
export function isFieldOnly(roles: string[]): boolean {
  if (roles.length === 0) return false;
  return !roles.some(isOfficeRole);
}

/**
 * Who may override a failed gate check.
 *
 * Deliberately narrow. An override lets a job past a check that is genuinely
 * failing, so it belongs to whoever answers for the job going wrong -- not to
 * whoever happens to be standing in the garden when the gate is locked. A crew
 * member raises an issue instead, which is the honest record of the same
 * situation.
 */
const OVERRIDE_ROLES = ["admin", "owner", "manager"];

export function canOverrideGate(roles: string[]): boolean {
  return roles.some((role) => OVERRIDE_ROLES.includes(normalizeRole(role)));
}
