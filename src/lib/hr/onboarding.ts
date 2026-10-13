/**
 * What has to happen when somebody is hired, and by when.
 *
 * Federal: an I-9 within 3 business days of the first day, and a W-4.
 * Maryland: the MW507 withholding form, and the new-hire report to the state
 * within 20 calendar days (MD DHS; $20 a month per violation). Anybody who
 * will handle pesticides finishes MDA-approved training within 30 days, and
 * until then works only with a certified applicator or registered employee
 * physically present. Everybody signs for the handbook and gets the equipment
 * and safety walk-through before they run anything with a blade.
 *
 * Affiliates are not employees: they bring leads for a commission and get a
 * W-9, not a W-4.
 *
 * Pure, so the dates are tested without a database.
 */

export interface ChecklistItemTemplate {
  key: string;
  label: string;
  dueOn: string;
}

const DAY = 86_400_000;

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso.slice(0, 10)}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** Business days after a date: Saturdays and Sundays do not count. Holidays are not modelled. */
export function addBusinessDays(iso: string, days: number): string {
  let d = new Date(Date.parse(`${iso.slice(0, 10)}T12:00:00Z`));
  let left = days;
  while (left > 0) {
    d = new Date(d.getTime() + DAY);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

/** Positions that are employees rather than commission-only contractors. */
export function isEmployeePosition(position: string | null | undefined): boolean {
  return position !== "affiliate";
}

/** Whether a position normally handles chemicals. A default the owner can change per person. */
export function handlesPesticidesByDefault(position: string | null | undefined): boolean {
  return position === "project-technician" || position === "project-lead";
}

/** The checklist for one hire, with each item's due date from their first day. */
export function checklistFor(input: { position: string | null; startDate: string; handlesPesticides: boolean }): ChecklistItemTemplate[] {
  const start = input.startDate.slice(0, 10);
  if (!isEmployeePosition(input.position)) {
    return [
      { key: "w9", label: "W-9 on file", dueOn: addDays(start, 7) },
      { key: "handbook", label: "Handbook / affiliate terms acknowledged", dueOn: addDays(start, 7) },
    ];
  }
  const items: ChecklistItemTemplate[] = [
    { key: "i9", label: "Form I-9 (within 3 business days)", dueOn: addBusinessDays(start, 3) },
    { key: "w4", label: "Federal W-4", dueOn: start },
    { key: "mw507", label: "Maryland MW507", dueOn: start },
    { key: "md_new_hire", label: "Maryland new-hire report (within 20 days)", dueOn: addDays(start, 20) },
    { key: "handbook", label: "Handbook acknowledgement", dueOn: addDays(start, 7) },
    { key: "safety", label: "Equipment and safety training", dueOn: addDays(start, 7) },
  ];
  if (input.handlesPesticides) {
    items.push({ key: "pesticide_training", label: "MDA pesticide employee training (within 30 days)", dueOn: addDays(start, 30) });
  }
  return items;
}

export interface ItemState {
  dueOn: string;
  doneAt: string | null;
  waived: boolean;
}

/** Overdue: past its date, not done, not waived. */
export function isItemOverdue(item: ItemState, today: string): boolean {
  return !item.doneAt && !item.waived && item.dueOn < today.slice(0, 10);
}

export function checklistProgress(items: ItemState[], today: string): { done: number; total: number; overdue: number; complete: boolean } {
  const total = items.length;
  const done = items.filter((i) => i.doneAt || i.waived).length;
  const overdue = items.filter((i) => isItemOverdue(i, today)).length;
  return { done, total, overdue, complete: total > 0 && done === total };
}
