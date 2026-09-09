/**
 * The weeds, and the two sheets they go on.
 *
 * One list of what grows in a Maryland lawn, kept in the order a crew reads
 * it: the perennials that come back, then what arrives with the cold, then
 * what arrives with the heat, then the grasses that hide in grass, then the
 * sedges, then the things with thorns. The client sheet is a subset of the
 * same list -- the twenty-seven a homeowner actually points at -- so a weed
 * is never described two different ways depending on who is holding the
 * paper.
 *
 * This is the seed. Once a business has the guide, the rows in the database
 * are the truth: a weed can be taken off the client sheet, given a photo, or
 * given the prep note that belongs with it, and none of that comes back here.
 */

export type WeedGroup =
  | "Broadleaf perennials"
  | "Winter annuals"
  | "Summer annuals"
  | "Grassy weeds"
  | "Sedges & rushes"
  | "Vines & woody";

/** The order the groups print in. */
export const WEED_GROUPS: readonly WeedGroup[] = [
  "Broadleaf perennials",
  "Winter annuals",
  "Summer annuals",
  "Grassy weeds",
  "Sedges & rushes",
  "Vines & woody",
];

export interface WeedSeed {
  /** Stable across businesses, and what a photo filename is named after. */
  slug: string;
  common: string;
  scientific: string;
  group: WeedGroup;
  /** Whether it starts on the sheet a client is given. */
  client: boolean;
}

export const WEED_SEED: readonly WeedSeed[] = [
  { slug: "taraxacum-officinale", common: "Dandelion", scientific: "Taraxacum officinale", group: "Broadleaf perennials", client: true },
  { slug: "trifolium-repens", common: "White Clover", scientific: "Trifolium repens", group: "Broadleaf perennials", client: true },
  { slug: "plantago-major", common: "Broadleaf Plantain", scientific: "Plantago major", group: "Broadleaf perennials", client: true },
  { slug: "plantago-lanceolata", common: "Buckhorn Plantain", scientific: "Plantago lanceolata", group: "Broadleaf perennials", client: true },
  { slug: "glechoma-hederacea", common: "Ground Ivy", scientific: "Glechoma hederacea", group: "Broadleaf perennials", client: true },
  { slug: "viola-sororia", common: "Wild Violet", scientific: "Viola sororia", group: "Broadleaf perennials", client: true },
  { slug: "oxalis-stricta", common: "Yellow Woodsorrel", scientific: "Oxalis stricta", group: "Broadleaf perennials", client: true },
  { slug: "potentilla-indica", common: "Mock Strawberry", scientific: "Potentilla indica", group: "Broadleaf perennials", client: true },
  { slug: "diodia-virginiana", common: "Virginia Buttonweed", scientific: "Diodia virginiana", group: "Broadleaf perennials", client: true },
  { slug: "prunella-vulgaris", common: "Heal-all", scientific: "Prunella vulgaris", group: "Broadleaf perennials", client: false },
  { slug: "achillea-millefolium", common: "Common Yarrow", scientific: "Achillea millefolium", group: "Broadleaf perennials", client: false },
  { slug: "ranunculus-repens", common: "Creeping Buttercup", scientific: "Ranunculus repens", group: "Broadleaf perennials", client: false },
  { slug: "rumex-crispus", common: "Curly Dock", scientific: "Rumex crispus", group: "Broadleaf perennials", client: false },
  { slug: "rumex-obtusifolius", common: "Broadleaf Dock", scientific: "Rumex obtusifolius", group: "Broadleaf perennials", client: false },
  { slug: "cirsium-arvense", common: "Canada Thistle", scientific: "Cirsium arvense", group: "Broadleaf perennials", client: true },
  { slug: "cirsium-vulgare", common: "Bull Thistle", scientific: "Cirsium vulgare", group: "Broadleaf perennials", client: false },
  { slug: "artemisia-vulgaris", common: "Mugwort", scientific: "Artemisia vulgaris", group: "Broadleaf perennials", client: true },
  { slug: "solanum-carolinense", common: "Horsenettle", scientific: "Solanum carolinense", group: "Broadleaf perennials", client: false },
  { slug: "phytolacca-americana", common: "Pokeweed", scientific: "Phytolacca americana", group: "Broadleaf perennials", client: false },
  { slug: "convolvulus-arvensis", common: "Field Bindweed", scientific: "Convolvulus arvensis", group: "Broadleaf perennials", client: false },
  { slug: "calystegia-sepium", common: "Hedge Bindweed", scientific: "Calystegia sepium", group: "Broadleaf perennials", client: false },
  { slug: "ornithogalum-umbellatum", common: "Star of Bethlehem", scientific: "Ornithogalum umbellatum", group: "Broadleaf perennials", client: false },
  { slug: "stellaria-media", common: "Common Chickweed", scientific: "Stellaria media", group: "Winter annuals", client: true },
  { slug: "cerastium-fontanum", common: "Mouse-ear Chickweed", scientific: "Cerastium fontanum", group: "Winter annuals", client: false },
  { slug: "lamium-amplexicaule", common: "Henbit", scientific: "Lamium amplexicaule", group: "Winter annuals", client: true },
  { slug: "lamium-purpureum", common: "Purple Deadnettle", scientific: "Lamium purpureum", group: "Winter annuals", client: true },
  { slug: "cardamine-hirsuta", common: "Hairy Bittercress", scientific: "Cardamine hirsuta", group: "Winter annuals", client: true },
  { slug: "veronica-arvensis", common: "Corn Speedwell", scientific: "Veronica arvensis", group: "Winter annuals", client: true },
  { slug: "veronica-persica", common: "Persian Speedwell", scientific: "Veronica persica", group: "Winter annuals", client: false },
  { slug: "capsella-bursa-pastoris", common: "Shepherd's Purse", scientific: "Capsella bursa-pastoris", group: "Winter annuals", client: false },
  { slug: "senecio-vulgaris", common: "Common Groundsel", scientific: "Senecio vulgaris", group: "Winter annuals", client: false },
  { slug: "medicago-lupulina", common: "Black Medic", scientific: "Medicago lupulina", group: "Winter annuals", client: true },
  { slug: "allium-vineale", common: "Wild Garlic", scientific: "Allium vineale", group: "Winter annuals", client: true },
  { slug: "euphorbia-maculata", common: "Spotted Spurge", scientific: "Euphorbia maculata", group: "Summer annuals", client: true },
  { slug: "polygonum-aviculare", common: "Prostrate Knotweed", scientific: "Polygonum aviculare", group: "Summer annuals", client: true },
  { slug: "portulaca-oleracea", common: "Common Purslane", scientific: "Portulaca oleracea", group: "Summer annuals", client: true },
  { slug: "mollugo-verticillata", common: "Carpetweed", scientific: "Mollugo verticillata", group: "Summer annuals", client: false },
  { slug: "chenopodium-album", common: "Lambsquarters", scientific: "Chenopodium album", group: "Summer annuals", client: false },
  { slug: "amaranthus-retroflexus", common: "Redroot Pigweed", scientific: "Amaranthus retroflexus", group: "Summer annuals", client: false },
  { slug: "ambrosia-artemisiifolia", common: "Common Ragweed", scientific: "Ambrosia artemisiifolia", group: "Summer annuals", client: false },
  { slug: "euphorbia-humistrata", common: "Prostrate Spurge", scientific: "Euphorbia humistrata", group: "Summer annuals", client: false },
  { slug: "digitaria-sanguinalis", common: "Large Crabgrass", scientific: "Digitaria sanguinalis", group: "Grassy weeds", client: true },
  { slug: "digitaria-ischaemum", common: "Smooth Crabgrass", scientific: "Digitaria ischaemum", group: "Grassy weeds", client: false },
  { slug: "eleusine-indica", common: "Goosegrass", scientific: "Eleusine indica", group: "Grassy weeds", client: true },
  { slug: "poa-annua", common: "Annual Bluegrass", scientific: "Poa annua", group: "Grassy weeds", client: true },
  { slug: "setaria-pumila", common: "Yellow Foxtail", scientific: "Setaria pumila", group: "Grassy weeds", client: false },
  { slug: "setaria-viridis", common: "Green Foxtail", scientific: "Setaria viridis", group: "Grassy weeds", client: false },
  { slug: "echinochloa-crus-galli", common: "Barnyardgrass", scientific: "Echinochloa crus-galli", group: "Grassy weeds", client: false },
  { slug: "microstegium-vimineum", common: "Japanese Stiltgrass", scientific: "Microstegium vimineum", group: "Grassy weeds", client: true },
  { slug: "muhlenbergia-schreberi", common: "Nimblewill", scientific: "Muhlenbergia schreberi", group: "Grassy weeds", client: false },
  { slug: "elymus-repens", common: "Quackgrass", scientific: "Elymus repens", group: "Grassy weeds", client: false },
  { slug: "cynodon-dactylon", common: "Bermudagrass", scientific: "Cynodon dactylon", group: "Grassy weeds", client: false },
  { slug: "paspalum-dilatatum", common: "Dallisgrass", scientific: "Paspalum dilatatum", group: "Grassy weeds", client: false },
  { slug: "schedonorus-arundinaceus", common: "Tall Fescue clumps", scientific: "Schedonorus arundinaceus", group: "Grassy weeds", client: false },
  { slug: "cyperus-esculentus", common: "Yellow Nutsedge", scientific: "Cyperus esculentus", group: "Sedges & rushes", client: true },
  { slug: "kyllinga-brevifolia", common: "Green Kyllinga", scientific: "Kyllinga brevifolia", group: "Sedges & rushes", client: false },
  { slug: "juncus-tenuis", common: "Path Rush", scientific: "Juncus tenuis", group: "Sedges & rushes", client: false },
  { slug: "toxicodendron-radicans", common: "Poison Ivy", scientific: "Toxicodendron radicans", group: "Vines & woody", client: true },
  { slug: "lonicera-japonica", common: "Japanese Honeysuckle", scientific: "Lonicera japonica", group: "Vines & woody", client: false },
  { slug: "celastrus-orbiculatus", common: "Oriental Bittersweet", scientific: "Celastrus orbiculatus", group: "Vines & woody", client: false },
  { slug: "rosa-multiflora", common: "Multiflora Rose", scientific: "Rosa multiflora", group: "Vines & woody", client: false },
  { slug: "rubus-allegheniensis", common: "Wild Blackberry", scientific: "Rubus allegheniensis", group: "Vines & woody", client: false },
  { slug: "hedera-helix", common: "English Ivy", scientific: "Hedera helix", group: "Vines & woody", client: false },
];

/** One weed as the app holds it: the seed, plus what a business changed. */
export interface Weed {
  id: string;
  slug: string;
  common: string;
  scientific: string;
  group: WeedGroup;
  /** On the sheet a client is given. */
  client: boolean;
  /**
   * The short code printed under the photo and encoded in its QR. Six
   * characters from the same alphabet as the stock labels, so it can be
   * read down a phone when a camera will not focus.
   */
  code: string;
  /**
   * The one photo that prints. Uploaded by hand, because a stock photo of
   * crabgrass is as often a picture of a lawn, and paper cannot be swapped.
   */
  printPhotoId: string | null;
  /** What to do before treating it. Shared with the prep checklist. */
  prep: string | null;
  photos: WeedPhoto[];
}

export interface WeedPhoto {
  id: string;
  path: string;
  caption: string | null;
  credit: string | null;
  position: number;
}

export type SheetView = "client" | "crew";

export function isSheetView(value: string | null | undefined): value is SheetView {
  return value === "client" || value === "crew";
}

/** The weeds a sheet shows: the client's subset, or everything. */
export function weedsFor<T extends { client: boolean }>(weeds: readonly T[], view: SheetView): T[] {
  return view === "client" ? weeds.filter((w) => w.client) : [...weeds];
}

export interface WeedGroupBlock<T> {
  group: WeedGroup;
  weeds: T[];
}

/**
 * A sheet's weeds under their group headings, in printing order.
 *
 * Groups with nothing in them are dropped rather than printed empty: a
 * business that takes every sedge off the client sheet should not be given a
 * heading with a blank space under it.
 */
export function groupWeeds<T extends { group: WeedGroup }>(weeds: readonly T[]): WeedGroupBlock<T>[] {
  return WEED_GROUPS.map((group) => ({ group, weeds: weeds.filter((w) => w.group === group) })).filter(
    (block) => block.weeds.length > 0
  );
}

/**
 * How many cells go across a printed sheet.
 *
 * The client's is four to a row and big enough to recognise a weed from the
 * kerb; the crew's is five, because a crew is holding it a foot from their
 * face and would rather have the whole list on fewer pages.
 */
export function columnsFor(view: SheetView): number {
  return view === "client" ? 4 : 5;
}

/**
 * A group's weeds cut into rows, so a row can be an element of its own.
 *
 * One grid holding every weed in a group is one box as far as the printer is
 * concerned: "keep this together" on a cell inside it is a request browsers
 * are free to ignore, and they do, which is how a page came to start with the
 * bottom half of somebody's photograph. A row that is its own box is a request
 * they honour. It also gives each row somewhere to carry the space that keeps
 * it off the top edge of the paper.
 */
export function rowsOf<T>(weeds: readonly T[], columns: number): T[][] {
  if (columns < 1) return weeds.length > 0 ? [[...weeds]] : [];
  const rows: T[][] = [];
  for (let i = 0; i < weeds.length; i += columns) rows.push(weeds.slice(i, i + columns));
  return rows;
}

/** Where a scan of a weed's code lands. Short, so the QR stays coarse. */
export function weedScanPath(code: string): string {
  return `/w/${code}`;
}

/**
 * Whether the sheet ends with the caution and the offer to do it for them.
 *
 * The client's, and only the client's. A crew already knows that half of these
 * come back worse if you leave the root, and they are not going to scan a code
 * to book their own company.
 */
export function showsBookingOffer(view: SheetView): boolean {
  return view === "client";
}

/**
 * Where the offer's code sends somebody.
 *
 * The organisation slug carries the booking through to the right business. The
 * booking page works without it, so a business that has never been given a slug
 * still gets a code that goes somewhere rather than no code at all.
 */
export function bookingPath(orgSlug: string | null | undefined): string {
  return orgSlug ? `/book?org=${orgSlug}` : "/book";
}
