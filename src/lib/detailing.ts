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
