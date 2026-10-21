// Business details and service menu for the Apex Shine Mobile marketing page.
// Edit this file to update copy, contact info, or pricing without touching markup.

export const business = {
  name: "Apex Shine Mobile",
  tagline: "Premium Mobile Detailing",
  phoneDisplay: "443-528-0896",
  phoneHref: "tel:+14435280896",
  smsHref: "sms:+14435280896",
  email: "jace@apexshinemobile.com",
  instagramHandle: "@apex.shinemobile",
  instagramUrl: "https://www.instagram.com/apex.shinemobile/",
};

export type Service = {
  id: string;
  title: string;
  description: string;
  icon: "interior" | "exterior" | "ceramic" | "protection";
};

export const services: Service[] = [
  {
    id: "interior",
    title: "Interior",
    description:
      "Deep vacuum, steam and shampoo of seats and carpets, leather cleaned and conditioned, every vent, crevice and surface wiped down.",
    icon: "interior",
  },
  {
    id: "exterior",
    title: "Exterior",
    description:
      "Foam pre-wash, two-bucket hand wash, wheels and tires deep cleaned, iron decontamination and a slick layer of protection.",
    icon: "exterior",
  },
  {
    id: "ceramic",
    title: "Ceramic Coatings",
    description:
      "Long-lasting, hydrophobic gloss that repels water, dirt and UV. Easier washes and a finish that stays deep for years.",
    icon: "ceramic",
  },
  {
    id: "protection",
    title: "Paint Protection",
    description:
      "Paint correction to remove swirls and light scratches, sealed in with sealants or coatings to keep it looking new.",
    icon: "protection",
  },
];

export type DetailPackage = {
  id: string;
  name: string;
  // null renders "Get a quote". Set a number (e.g. 149) to show "From $149".
  startingPrice: number | null;
  blurb: string;
  features: string[];
  featured?: boolean;
};

export const packages: DetailPackage[] = [
  {
    id: "interior",
    name: "Interior Detail",
    startingPrice: null,
    blurb: "A reset for the inside of your car.",
    features: [
      "Full vacuum incl. trunk",
      "Seat & carpet shampoo",
      "Leather clean & condition",
      "Dash, console & door panels",
      "Streak-free glass",
    ],
  },
  {
    id: "full",
    name: "Full Detail",
    startingPrice: null,
    blurb: "Inside and out — our most popular service.",
    features: [
      "Everything in Interior",
      "Foam pre-wash & hand wash",
      "Wheels, tires & wells",
      "Clay / decontamination",
      "Spray sealant protection",
    ],
    featured: true,
  },
  {
    id: "ceramic",
    name: "Ceramic Coating",
    startingPrice: null,
    blurb: "Maximum gloss and long-term protection.",
    features: [
      "Full exterior decon",
      "Paint correction",
      "Professional ceramic coating",
      "Wheels & glass coated",
      "Aftercare guide",
    ],
  },
];

export const steps = [
  {
    title: "Book",
    description: "Call, text, or send a request with your vehicle and the service you want.",
  },
  {
    title: "We come to you",
    description: "We show up at your home or work with everything we need.",
  },
  {
    title: "Drive away shining",
    description: "Walk out to a car that looks, feels, and smells brand new.",
  },
];

export const vehicleTypes = ["Sedan / Coupe", "SUV / Crossover", "Truck", "Van / 3-row"];

// ---- Booking funnel (/detailing/start) ----
// The funnel sells one thing: the Complete Care monthly membership.

export const firstTimeDiscount = 20;

export type VehicleSize = "sedan" | "suv" | "truck";

// Monthly price by vehicle size, in whole dollars. Sedan matches the $199
// Complete Care flyer; larger vehicles step up roughly in line with the
// one-time size pricing (SUVs ~20% more, trucks ~35% more).
export const membershipPrices: Record<VehicleSize, { label: string; examples: string; price: number }> = {
  sedan: { label: "Sedan / Coupe", examples: "Civic, Camry, Model 3", price: 199 },
  suv: { label: "SUV / Crossover", examples: "RAV4, Explorer, CR-V", price: 239 },
  truck: { label: "Truck / Van / 3-Row", examples: "F-150, Tahoe, Odyssey", price: 269 },
};

export const membershipIncludes = {
  interior: [
    "Full vacuum — seats, carpets, mats & trunk",
    "Dashboard & console wipe down",
    "Door panels & jambs cleaned",
    "Interior windows cleaned",
    "Trash removal",
  ],
  exterior: [
    "Foam pre-wash & hand wash",
    "Wheels & tires cleaned + tire shine",
    "Exterior windows & mirrors cleaned",
    "Exterior wipe down & trim",
    "Spray wax protection every visit",
  ],
};

export const membershipBenefits = [
  "Mobile service at your home or work",
  "Priority scheduling",
  "Locked-in monthly pricing",
  "Discounted add-on services",
  "Professional service every time",
];

export type AddOn = { id: string; name: string; description: string; price: number };

// Member add-on prices, in whole dollars. Added to the visit they're booked on.
export const addOns: AddOn[] = [
  { id: "deodorizer", name: "Interior Deodorizer", description: "Fresh-scent treatment for carpets, seats and vents.", price: 15 },
  { id: "odor", name: "Odor Removal Treatment", description: "Ozone / enzyme treatment for smoke, pet and food odors.", price: 59 },
  { id: "pet-hair", name: "Pet Hair Removal", description: "Deep extraction of embedded pet hair from fabric and carpet.", price: 39 },
  { id: "shampoo", name: "Stain Extraction / Shampoo", description: "Hot-water extraction of seats and carpets.", price: 59 },
  { id: "leather", name: "Leather Clean & Condition", description: "Cleaned, conditioned and protected from cracking.", price: 35 },
  { id: "glass", name: "Glass Rain-Repellent", description: "Water beads off the windshield and windows for months.", price: 29 },
  { id: "clay", name: "Clay Bar Decontamination", description: "Removes bonded grime so paint feels smooth as glass.", price: 49 },
  { id: "sealant", name: "Ceramic Spray Sealant", description: "Upgrade from wax to months of ceramic gloss and protection.", price: 39 },
  { id: "headlights", name: "Headlight Restoration", description: "Cloudy, yellow headlights polished clear and sealed.", price: 69 },
  { id: "engine", name: "Engine Bay Cleaning", description: "Degreased, rinsed and dressed.", price: 45 },
];
