import { createClient } from "@/lib/supabase/server";
import { isMissingTable } from "@/lib/setup-errors";
import { getCurrentOrganization } from "@/lib/data/organizations";
import {
  buyingList,
  DEFAULT_SALT_SETTINGS,
  type BuyingList,
  type SaltSettings,
  type Surface,
} from "@/lib/salt";

/**
 * Who has prepaid a winter, and what still has to be bought to cover them.
 *
 * The two questions the office has about this are different and are answered
 * together on purpose. "Who is on the round" is a list of addresses to drive.
 * "What do we owe them" is a number of bags to order, and it is worked out
 * from treatments still undelivered rather than treatments sold, so a season
 * half done stops asking for product that is already spread.
 */

export interface SaltOrderRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  address: string;
  surface: Surface;
  petFriendly: boolean;
  treatments: number;
  used: number;
  amountCents: number;
  perTreatmentCents: number;
  status: string;
  paidAt: string | null;
  jobId: string | null;
  customerId: string | null;
  /**
   * Paid, but the address could not be placed on the map, so no property and
   * no job exist for it yet. One thing for a person to finish, and the only
   * kind of row on this list that is actually urgent.
   */
  needsPlacing: boolean;
}

export interface SaltBoard {
  orders: SaltOrderRow[];
  buying: BuyingList;
  settings: SaltSettings;
  /** Treatments sold and paid for across the season. */
  soldTreatments: number;
  /** Money taken. */
  takenCents: number;
  /** Orders paid for that nobody has placed on the map. */
  unplaced: number;
}

const EMPTY_BOARD: SaltBoard = {
  orders: [],
  buying: buyingList([]),
  settings: DEFAULT_SALT_SETTINGS,
  soldTreatments: 0,
  takenCents: 0,
  unplaced: 0,
};

export async function getSaltBoard(): Promise<SaltBoard> {
  const supabase = await createClient();
  const organization = await getCurrentOrganization().catch(() => null);

  const { data, error } = await supabase
    .from("salt_orders")
    .select(
      "id, name, email, phone, address, surface, pet_friendly, treatments, treatments_used, amount_cents, per_treatment_cents, status, paid_at, job_id, customer_id, property_id"
    )
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingTable(error)) return EMPTY_BOARD;
    throw error;
  }

  const settings: SaltSettings = organization
    ? {
        bagCostCents: organization.salt_bag_cost_cents ?? DEFAULT_SALT_SETTINGS.bagCostCents,
        petBagCostCents:
          organization.salt_pet_bag_cost_cents ?? DEFAULT_SALT_SETTINGS.petBagCostCents,
        bagPounds: organization.salt_bag_pounds ?? DEFAULT_SALT_SETTINGS.bagPounds,
        sidewalkPounds:
          Number(organization.salt_sidewalk_pounds) || DEFAULT_SALT_SETTINGS.sidewalkPounds,
        drivewayPounds:
          Number(organization.salt_driveway_pounds) || DEFAULT_SALT_SETTINGS.drivewayPounds,
        sidewalkMinutes:
          organization.salt_sidewalk_minutes ?? DEFAULT_SALT_SETTINGS.sidewalkMinutes,
        drivewayMinutes:
          organization.salt_driveway_minutes ?? DEFAULT_SALT_SETTINGS.drivewayMinutes,
        crewCostPerHourCents: DEFAULT_SALT_SETTINGS.crewCostPerHourCents,
        overheadPerCrewHourCents: DEFAULT_SALT_SETTINGS.overheadPerCrewHourCents,
        multiplier: DEFAULT_SALT_SETTINGS.multiplier,
        petSurchargeCents: organization.salt_pet_surcharge_cents ?? 0,
      }
    : DEFAULT_SALT_SETTINGS;

  const orders: SaltOrderRow[] = (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    surface: row.surface as Surface,
    petFriendly: row.pet_friendly,
    treatments: row.treatments,
    used: row.treatments_used,
    amountCents: row.amount_cents,
    perTreatmentCents: row.per_treatment_cents,
    status: row.status,
    paidAt: row.paid_at,
    jobId: row.job_id,
    customerId: row.customer_id,
    needsPlacing: row.status === "paid" && !row.property_id,
  }));

  // Only what has been paid for. An unpaid row is somebody who opened the card
  // sheet and closed it, and buying salt for them would be buying salt for
  // nobody.
  const paid = orders.filter((order) => order.status === "paid");

  return {
    orders,
    buying: buyingList(
      paid.map((order) => ({
        surface: order.surface,
        petFriendly: order.petFriendly,
        treatments: order.treatments,
        used: order.used,
      })),
      settings
    ),
    settings,
    soldTreatments: paid.reduce((sum, order) => sum + order.treatments, 0),
    takenCents: paid.reduce((sum, order) => sum + order.amountCents, 0),
    unplaced: paid.filter((order) => order.needsPlacing).length,
  };
}
