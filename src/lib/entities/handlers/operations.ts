import type { EntityHandler } from "@/lib/entities/types";
import { OPS_JOB_HANDLERS } from "@/lib/entities/handlers/ops/jobs";
import { OPS_PEOPLE_HANDLERS } from "@/lib/entities/handlers/ops/people";
import { OPS_SUPPLY_HANDLERS } from "@/lib/entities/handlers/ops/supplies";
import { OPS_WEATHER_HANDLERS } from "@/lib/entities/handlers/ops/weather";

/**
 * What can be opened and done from the Operations page's lists.
 *
 * ops.job, ops.work_day, ops.issue, ops.exception, ops.walkthrough,
 * ops.review, ops.client — the work and its close-out (ops/jobs.ts).
 * ops.material, ops.supplier, ops.po, ops.kit, ops.asset, ops.tool — what
 * the jobs use and the crews carry (ops/supplies.ts).
 * ops.crew_member, ops.payment, ops.applicant, ops.indeed_invite — the
 * team (ops/people.ts).
 * ops.snow_event, ops.weather_move — storms and rain (ops/weather.ts).
 */
export const OPERATIONS_HANDLERS: EntityHandler[] = [...OPS_JOB_HANDLERS, ...OPS_SUPPLY_HANDLERS, ...OPS_PEOPLE_HANDLERS, ...OPS_WEATHER_HANDLERS];
