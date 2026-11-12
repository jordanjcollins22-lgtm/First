/**
 * The business lead list from the 2026-11-12 research (board-work
 * business-leads.csv, 44 rows), as seed prospects for the lead finder.
 *
 * Businesses, churches, apartment communities and one HOA only: names and
 * public business phones as the businesses publish them, no private people.
 * No coordinates: the review card links to Street View and satellite by
 * address until the roll's pull puts a point on them.
 *
 * Generated from the CSV; edit the CSV and regenerate rather than by hand.
 */

import type { FinderCategory, FinderService } from "@/lib/lead-finder";

export interface SeedProspect {
  /** Stable key, so importing the list twice updates rather than duplicates. */
  key: string;
  priority: "A" | "B" | "C";
  name: string;
  /** The list's own type, e.g. "Self-storage". */
  type: string;
  category: FinderCategory;
  address: string;
  city: string;
  zip: string;
  phone: string | null;
  website: string | null;
  /** What the list expected them to buy. */
  services: FinderService[];
  /** Why the list picked them. */
  reason: string;
}

export const SEED_PROSPECTS: SeedProspect[] = [
  {
    "key": "seed:st-ignatius-church-hickory",
    "priority": "A",
    "name": "St. Ignatius Church (Hickory)",
    "type": "Church",
    "category": "church",
    "address": "533 E Jarrettsville Rd",
    "city": "Forest Hill",
    "zip": "21050",
    "phone": "(410) 879-1926",
    "website": "https://stignatiushickory.org/",
    "services": [
      "mulch",
      "pressure_washing",
      "sealcoating"
    ],
    "reason": "Historic church on large grounds with a parking lot; curb appeal matters for weddings and funerals"
  },
  {
    "key": "seed:forest-hill-presbyterian-church",
    "priority": "A",
    "name": "Forest Hill Presbyterian Church",
    "type": "Church",
    "category": "church",
    "address": "23 Newport Dr",
    "city": "Forest Hill",
    "zip": "21050",
    "phone": "(410) 838-7674",
    "website": null,
    "services": [
      "mulch",
      "pressure_washing",
      "sealcoating"
    ],
    "reason": "Church on its own lot in the Newport Dr business area; parking lot and beds"
  },
  {
    "key": "seed:christ-s-church-forest-hill",
    "priority": "A",
    "name": "Christ's Church, Forest Hill",
    "type": "Church",
    "category": "church",
    "address": "2100 Rock Spring Rd",
    "city": "Forest Hill",
    "zip": "21050",
    "phone": "(410) 879-9550",
    "website": null,
    "services": [
      "mulch",
      "pressure_washing",
      "sealcoating"
    ],
    "reason": "Large Rock Spring Rd church campus with big parking lot"
  },
  {
    "key": "seed:fairview-ame-church",
    "priority": "B",
    "name": "Fairview AME Church",
    "type": "Church",
    "category": "church",
    "address": "2328 High Point Rd",
    "city": "Forest Hill",
    "zip": "21050",
    "phone": "(410) 838-1131",
    "website": null,
    "services": [
      "mulch",
      "pressure_washing",
      "leaf_cleanup"
    ],
    "reason": "Older church with grounds and cemetery-style lawn areas"
  },
  {
    "key": "seed:victorious-faith-fellowship",
    "priority": "B",
    "name": "Victorious Faith Fellowship",
    "type": "Church",
    "category": "church",
    "address": "106 Rock Spring Church Rd",
    "city": "Forest Hill",
    "zip": "21050",
    "phone": "(410) 838-1214",
    "website": null,
    "services": [
      "mulch",
      "sealcoating"
    ],
    "reason": "Church property with parking; easy add-on to nearby routes"
  },
  {
    "key": "seed:forest-ridge-baptist-church",
    "priority": "B",
    "name": "Forest Ridge Baptist Church",
    "type": "Church",
    "category": "church",
    "address": "2435 Bailey Rd",
    "city": "Forest Hill",
    "zip": "21050",
    "phone": "(410) 420-3722",
    "website": null,
    "services": [
      "mulch",
      "pressure_washing",
      "leaf_cleanup"
    ],
    "reason": "Church grounds and lot"
  },
  {
    "key": "seed:forest-hill-automotive",
    "priority": "A",
    "name": "Forest Hill Automotive",
    "type": "Auto shop",
    "category": "commercial",
    "address": "209 E Jarrettsville Rd",
    "city": "Forest Hill",
    "zip": "21050",
    "phone": "(410) 399-9977",
    "website": null,
    "services": [
      "mulch",
      "pressure_washing",
      "sealcoating",
      "leaf_cleanup"
    ],
    "reason": "Auto shops get oil-stained concrete and worn asphalt"
  },
  {
    "key": "seed:forest-hill-car-care",
    "priority": "A",
    "name": "Forest Hill Car Care",
    "type": "Auto shop",
    "category": "commercial",
    "address": "2403 Rocks Rd",
    "city": "Forest Hill",
    "zip": "21050",
    "phone": "(410) 838-3116",
    "website": null,
    "services": [
      "pressure_washing",
      "sealcoating"
    ],
    "reason": "Customer-facing lot on Rocks Rd; stains and cracks typical"
  },
  {
    "key": "seed:rosso-service",
    "priority": "B",
    "name": "Rosso Service",
    "type": "Auto shop",
    "category": "commercial",
    "address": "7 Newport Dr Ste A",
    "city": "Forest Hill",
    "zip": "21050",
    "phone": "(410) 638-2886",
    "website": null,
    "services": [
      "pressure_washing",
      "sealcoating"
    ],
    "reason": "Tenant in Newport Dr flex buildings; also a door into the landlord"
  },
  {
    "key": "seed:the-kunkel-service-co",
    "priority": "B",
    "name": "The Kunkel Service Co",
    "type": "Service business",
    "category": "commercial",
    "address": "2203 Commerce Rd",
    "city": "Forest Hill",
    "zip": "21050",
    "phone": "(410) 879-1053",
    "website": null,
    "services": [
      "mulch",
      "pressure_washing",
      "mowing"
    ],
    "reason": "Commerce Rd industrial park building with frontage beds"
  },
  {
    "key": "seed:firstservice-residential-forest-hill-office",
    "priority": "A",
    "name": "FirstService Residential (Forest Hill office)",
    "type": "HOA/condo management company",
    "category": "hoa",
    "address": "2211 Commerce Rd Ste 1A",
    "city": "Forest Hill",
    "zip": "21050",
    "phone": "800-870-0010",
    "website": "https://www.fsresidential.com/maryland/offices/forest-hill-md",
    "services": [
      "mulch",
      "pressure_washing",
      "sealcoating"
    ],
    "reason": "Manages many HOAs/condos; get on their approved-vendor list for bids"
  },
  {
    "key": "seed:rock-spring-station-retail-center",
    "priority": "B",
    "name": "Rock Spring Station (retail center)",
    "type": "Retail strip",
    "category": "commercial",
    "address": "1998 Rock Spring Rd",
    "city": "Forest Hill",
    "zip": "21050",
    "phone": null,
    "website": null,
    "services": [
      "mulch",
      "pressure_washing",
      "sealcoating"
    ],
    "reason": "12,000 SF retail center; leasing by MacKenzie; find owner via SDAT"
  },
  {
    "key": "seed:office-building-2018-rock-spring-rd",
    "priority": "C",
    "name": "Office building, 2018 Rock Spring Rd",
    "type": "Office",
    "category": "commercial",
    "address": "2018 Rock Spring Rd",
    "city": "Forest Hill",
    "zip": "21050",
    "phone": null,
    "website": null,
    "services": [
      "mulch",
      "pressure_washing",
      "sealcoating"
    ],
    "reason": "10,669 SF leased office building; owner via SDAT"
  },
  {
    "key": "seed:fallston-united-methodist-church",
    "priority": "A",
    "name": "Fallston United Methodist Church",
    "type": "Church",
    "category": "church",
    "address": "1509 Fallston Rd",
    "city": "Fallston",
    "zip": "21047",
    "phone": "(410) 877-7255",
    "website": null,
    "services": [
      "mulch",
      "pressure_washing",
      "sealcoating",
      "leaf_cleanup"
    ],
    "reason": "Fallston Rd church with large lot and beds"
  },
  {
    "key": "seed:fallston-presbyterian-church",
    "priority": "A",
    "name": "Fallston Presbyterian Church",
    "type": "Church",
    "category": "church",
    "address": "600 Fallston Rd",
    "city": "Fallston",
    "zip": "21047",
    "phone": "(443) 981-3127",
    "website": null,
    "services": [
      "mulch",
      "pressure_washing",
      "leaf_cleanup"
    ],
    "reason": "Church grounds on Fallston Rd"
  },
  {
    "key": "seed:prince-of-peace-baptist-church",
    "priority": "B",
    "name": "Prince of Peace Baptist Church",
    "type": "Church",
    "category": "church",
    "address": "1110 Old Fallston Rd",
    "city": "Fallston",
    "zip": "21047",
    "phone": "(410) 877-8445",
    "website": null,
    "services": [
      "mulch",
      "sealcoating"
    ],
    "reason": "Church with parking lot"
  },
  {
    "key": "seed:holy-communion-lutheran-church",
    "priority": "B",
    "name": "Holy Communion Lutheran Church",
    "type": "Church",
    "category": "church",
    "address": "621 Old Fallston Rd",
    "city": "Fallston",
    "zip": "21047",
    "phone": "(443) 299-6134",
    "website": null,
    "services": [
      "mulch",
      "leaf_cleanup"
    ],
    "reason": "Church grounds"
  },
  {
    "key": "seed:st-mark-catholic-church-fallston",
    "priority": "A",
    "name": "St. Mark Catholic Church (Fallston)",
    "type": "Church",
    "category": "church",
    "address": "2407 Laurel Brook Rd",
    "city": "Fallston",
    "zip": "21047",
    "phone": "(443) 299-6489",
    "website": null,
    "services": [
      "mulch",
      "pressure_washing",
      "sealcoating"
    ],
    "reason": "Large parish campus with school-size parking"
  },
  {
    "key": "seed:basta-pasta",
    "priority": "A",
    "name": "Basta Pasta",
    "type": "Restaurant",
    "category": "commercial",
    "address": "2745 Fallston Rd",
    "city": "Fallston",
    "zip": "21047",
    "phone": "410-692-5200",
    "website": null,
    "services": [
      "mulch",
      "pressure_washing"
    ],
    "reason": "Sit-down restaurant; clean entry and patio drive repeat customers"
  },
  {
    "key": "seed:fallston-barrel-house",
    "priority": "B",
    "name": "Fallston Barrel House",
    "type": "Restaurant/bar",
    "category": "commercial",
    "address": "2403 Bel Air Rd",
    "city": "Fallston",
    "zip": "21047",
    "phone": "443-981-3062",
    "website": null,
    "services": [
      "mulch",
      "pressure_washing"
    ],
    "reason": "Bar/restaurant with outdoor areas"
  },
  {
    "key": "seed:the-mallet-restaurant-and-crab-house",
    "priority": "B",
    "name": "The Mallet Restaurant and Crab House",
    "type": "Restaurant",
    "category": "commercial",
    "address": "2403 Bel Air Rd",
    "city": "Fallston",
    "zip": "21047",
    "phone": "410-877-2722",
    "website": null,
    "services": [
      "mulch",
      "pressure_washing"
    ],
    "reason": "Same center as Barrel House; pitch both together"
  },
  {
    "key": "seed:acappella-italian-restaurant",
    "priority": "B",
    "name": "Acappella Italian Restaurant",
    "type": "Restaurant",
    "category": "commercial",
    "address": "2402 Pleasantville Rd",
    "city": "Fallston",
    "zip": "21047",
    "phone": "410-878-7801",
    "website": null,
    "services": [
      "mulch",
      "pressure_washing"
    ],
    "reason": "Independent sit-down restaurant"
  },
  {
    "key": "seed:the-local",
    "priority": "B",
    "name": "The Local",
    "type": "Restaurant",
    "category": "commercial",
    "address": "1918 Bel Air Rd",
    "city": "Fallston",
    "zip": "21047",
    "phone": "443-299-6774",
    "website": null,
    "services": [
      "mulch",
      "pressure_washing"
    ],
    "reason": "Independent restaurant on Rt 1"
  },
  {
    "key": "seed:earth-wood-fire-fallston",
    "priority": "B",
    "name": "Earth, Wood & Fire - Fallston",
    "type": "Restaurant",
    "category": "commercial",
    "address": "214 Mountain Rd",
    "city": "Fallston",
    "zip": "21047",
    "phone": "410-401-4014",
    "website": null,
    "services": [
      "mulch",
      "pressure_washing"
    ],
    "reason": "Busy restaurant with outdoor seating"
  },
  {
    "key": "seed:stack-store-self-storage-fallston",
    "priority": "A",
    "name": "Stack & Store Self Storage (Fallston)",
    "type": "Self-storage",
    "category": "commercial",
    "address": "1621 Bel Air Rd",
    "city": "Fallston",
    "zip": "21047",
    "phone": "(410) 836-0802",
    "website": null,
    "services": [
      "mulch",
      "pressure_washing",
      "sealcoating"
    ],
    "reason": "Large asphalt area and long building walls"
  },
  {
    "key": "seed:calvert-s-walk",
    "priority": "A",
    "name": "Calvert's Walk",
    "type": "Apartments",
    "category": "apartments",
    "address": "200 Foxhall Dr",
    "city": "Bel Air",
    "zip": "21015",
    "phone": "(410) 575-1001",
    "website": null,
    "services": [
      "mulch",
      "pressure_washing",
      "sealcoating"
    ],
    "reason": "Multi-building community; spring mulch is a big recurring job"
  },
  {
    "key": "seed:harford-village-south-apartments",
    "priority": "A",
    "name": "Harford Village South Apartments",
    "type": "Apartments",
    "category": "apartments",
    "address": "800 Candlelight Dr",
    "city": "Bel Air",
    "zip": "21014",
    "phone": "(410) 893-0212",
    "website": null,
    "services": [
      "mulch",
      "pressure_washing",
      "sealcoating"
    ],
    "reason": "Older garden-style complex with lots of beds and lots"
  },
  {
    "key": "seed:the-park-at-winters-run",
    "priority": "A",
    "name": "The Park at Winters Run",
    "type": "Apartments",
    "category": "apartments",
    "address": "110 Old Joppa Ct",
    "city": "Bel Air",
    "zip": "21014",
    "phone": "(410) 420-0830",
    "website": null,
    "services": [
      "mulch",
      "pressure_washing",
      "sealcoating"
    ],
    "reason": "Multi-building apartment community"
  },
  {
    "key": "seed:james-run-apartments",
    "priority": "B",
    "name": "James Run Apartments",
    "type": "Apartments",
    "category": "apartments",
    "address": "2786 Megan Way",
    "city": "Bel Air",
    "zip": "21015",
    "phone": "(443) 643-9200",
    "website": null,
    "services": [
      "mulch",
      "pressure_washing"
    ],
    "reason": "Newer community; likely has a contract, bid at renewal"
  },
  {
    "key": "seed:hickory-court-apartments",
    "priority": "B",
    "name": "Hickory Court Apartments",
    "type": "Apartments",
    "category": "apartments",
    "address": "126 N Hickory Ave",
    "city": "Bel Air",
    "zip": "21014",
    "phone": "(410) 272-4422",
    "website": null,
    "services": [
      "mulch",
      "pressure_washing",
      "sealcoating"
    ],
    "reason": "Smaller in-town complex; owner may buy a la carte"
  },
  {
    "key": "seed:heritage-woods",
    "priority": "B",
    "name": "Heritage Woods",
    "type": "Apartments",
    "category": "apartments",
    "address": "700 Heritage Ln",
    "city": "Bel Air",
    "zip": "21014",
    "phone": null,
    "website": null,
    "services": [
      "mulch",
      "pressure_washing",
      "sealcoating"
    ],
    "reason": "Apartment community; phone not found"
  },
  {
    "key": "seed:hardy-s-self-storage",
    "priority": "A",
    "name": "Hardy's Self Storage",
    "type": "Self-storage",
    "category": "commercial",
    "address": "328 S Main St",
    "city": "Bel Air",
    "zip": "21014",
    "phone": "(410) 983-6991",
    "website": null,
    "services": [
      "pressure_washing",
      "sealcoating"
    ],
    "reason": "Local owner (not a REIT) can say yes on the spot"
  },
  {
    "key": "seed:stack-store-self-storage-bel-air",
    "priority": "A",
    "name": "Stack & Store Self Storage (Bel Air)",
    "type": "Self-storage",
    "category": "commercial",
    "address": "726 Baltimore Pike",
    "city": "Bel Air",
    "zip": "21014",
    "phone": "(410) 836-0801",
    "website": null,
    "services": [
      "mulch",
      "pressure_washing",
      "sealcoating"
    ],
    "reason": "Same owner as Fallston site: pitch both"
  },
  {
    "key": "seed:yourspace-storage-hickory",
    "priority": "B",
    "name": "YourSpace Storage @ Hickory",
    "type": "Self-storage",
    "category": "commercial",
    "address": "603 Hoagie Dr",
    "city": "Bel Air",
    "zip": "21014",
    "phone": "(844) 727-3035",
    "website": null,
    "services": [
      "pressure_washing",
      "sealcoating"
    ],
    "reason": "Storage lot; national call center number, ask for site manager"
  },
  {
    "key": "seed:children-s-urgent-care-of-bel-air",
    "priority": "B",
    "name": "Children's Urgent Care of Bel Air",
    "type": "Medical",
    "category": "commercial",
    "address": "611 Baltimore Pike",
    "city": "Bel Air",
    "zip": "21014",
    "phone": "(443) 787-4493",
    "website": null,
    "services": [
      "mulch",
      "pressure_washing"
    ],
    "reason": "Families judge clinics by how clean the entry looks"
  },
  {
    "key": "seed:plumtree-family-health-center",
    "priority": "B",
    "name": "Plumtree Family Health Center",
    "type": "Medical",
    "category": "commercial",
    "address": "104 Plumtree Rd",
    "city": "Bel Air",
    "zip": "21015",
    "phone": "(410) 569-4224",
    "website": null,
    "services": [
      "mulch",
      "pressure_washing"
    ],
    "reason": "Stand-alone medical office"
  },
  {
    "key": "seed:canby-motors",
    "priority": "B",
    "name": "Canby Motors",
    "type": "Auto shop",
    "category": "commercial",
    "address": "806 Baltimore Pike",
    "city": "Bel Air",
    "zip": "21014",
    "phone": "(410) 879-6007",
    "website": null,
    "services": [
      "pressure_washing",
      "sealcoating"
    ],
    "reason": "Auto shop on Rt 1 with visible lot"
  },
  {
    "key": "seed:kaiser-permanente-abingdon-medical-center",
    "priority": "C",
    "name": "Kaiser Permanente Abingdon Medical Center",
    "type": "Medical",
    "category": "commercial",
    "address": "3400 Box Hill Corporate Center Dr Ste 100",
    "city": "Abingdon",
    "zip": "21009",
    "phone": null,
    "website": null,
    "services": [
      "mulch",
      "pressure_washing"
    ],
    "reason": "Large medical building; likely national contract, ask property manager"
  },
  {
    "key": "seed:capital-women-s-care-box-hill",
    "priority": "C",
    "name": "Capital Women's Care (Box Hill)",
    "type": "Medical",
    "category": "commercial",
    "address": "3465 Box Hill Corporate Center Dr",
    "city": "Abingdon",
    "zip": "21009",
    "phone": "(410) 515-7600",
    "website": null,
    "services": [
      "mulch",
      "pressure_washing"
    ],
    "reason": "Tenant in Box Hill Corporate Center; use to reach building manager"
  },
  {
    "key": "seed:box-hill-pizzeria-and-crab-cakes",
    "priority": "B",
    "name": "Box Hill Pizzeria and Crab Cakes",
    "type": "Restaurant",
    "category": "commercial",
    "address": "2915 Emmorton Rd",
    "city": "Abingdon",
    "zip": "21009",
    "phone": "(410) 515-3662",
    "website": null,
    "services": [
      "pressure_washing"
    ],
    "reason": "Independent restaurant in Emmorton Rd retail"
  },
  {
    "key": "seed:abingdon-grill",
    "priority": "B",
    "name": "Abingdon Grill",
    "type": "Restaurant",
    "category": "commercial",
    "address": "418 Constant Friendship Blvd",
    "city": "Abingdon",
    "zip": "21009",
    "phone": "(443) 402-0270",
    "website": null,
    "services": [
      "mulch",
      "pressure_washing"
    ],
    "reason": "Independent restaurant"
  },
  {
    "key": "seed:bushmill-tavern",
    "priority": "B",
    "name": "Bushmill Tavern",
    "type": "Restaurant/bar",
    "category": "commercial",
    "address": "4017 Philadelphia Rd",
    "city": "Abingdon",
    "zip": "21009",
    "phone": "(410) 914-5820",
    "website": null,
    "services": [
      "mulch",
      "pressure_washing",
      "sealcoating"
    ],
    "reason": "Stand-alone tavern with own lot"
  },
  {
    "key": "seed:storageworks-snapbox-self-storage",
    "priority": "A",
    "name": "Storageworks / Snapbox Self Storage",
    "type": "Self-storage",
    "category": "commercial",
    "address": "403 Arundel Ct",
    "city": "Abingdon",
    "zip": "21009",
    "phone": "(410) 569-2211",
    "website": null,
    "services": [
      "pressure_washing",
      "sealcoating"
    ],
    "reason": "Storage lot in Abingdon"
  },
  {
    "key": "seed:box-hill-south-hoa",
    "priority": "B",
    "name": "Box Hill South (HOA)",
    "type": "HOA",
    "category": "hoa",
    "address": "",
    "city": "Abingdon",
    "zip": "21009",
    "phone": null,
    "website": null,
    "services": [
      "mulch",
      "leaf_cleanup"
    ],
    "reason": "Large planned community; find the board/manager via SDAT common-area parcel"
  }
];
