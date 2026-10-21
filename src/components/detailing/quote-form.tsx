"use client";

import { useState } from "react";
import { Mail, MessageSquare } from "lucide-react";

import { business, packages, vehicleTypes } from "@/lib/detailing";

const fieldClass =
  "w-full rounded-md border border-white/15 bg-white/5 px-4 py-3 text-base text-white placeholder:text-white/40 focus:border-[#d4a843] focus:outline-none focus:ring-1 focus:ring-[#d4a843]";

export function QuoteForm() {
  const [name, setName] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [vehicleType, setVehicleType] = useState(vehicleTypes[0]);
  const [service, setService] = useState(packages.find((p) => p.featured)?.name ?? packages[0].name);
  const [location, setLocation] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");

  const message = [
    `Hi Apex Shine! I'd like a quote.`,
    name && `Name: ${name}`,
    `Vehicle: ${[vehicle, `(${vehicleType})`].filter(Boolean).join(" ")}`,
    `Service: ${service}`,
    location && `Location: ${location}`,
    date && `Preferred date: ${date}`,
    notes && `Notes: ${notes}`,
  ]
    .filter(Boolean)
    .join("\n");

  const body = encodeURIComponent(message);
  const smsHref = `${business.smsHref}?&body=${body}`;
  const mailHref = `mailto:${business.email}?subject=${encodeURIComponent(
    `Quote request – ${service}`
  )}&body=${body}`;

  return (
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => e.preventDefault()}>
      <label className="grid gap-1.5 text-sm font-medium text-white/80">
        Name
        <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" />
      </label>
      <label className="grid gap-1.5 text-sm font-medium text-white/80">
        Vehicle
        <input className={fieldClass} value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="e.g. 2022 Honda Accord" />
      </label>
      <label className="grid gap-1.5 text-sm font-medium text-white/80">
        Vehicle type
        <select className={fieldClass} value={vehicleType} onChange={(e) => setVehicleType(e.target.value)}>
          {vehicleTypes.map((t) => (
            <option key={t} className="bg-black">
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1.5 text-sm font-medium text-white/80">
        Service
        <select className={fieldClass} value={service} onChange={(e) => setService(e.target.value)}>
          {packages.map((p) => (
            <option key={p.id} className="bg-black">
              {p.name}
            </option>
          ))}
          <option className="bg-black">Paint Protection / Correction</option>
          <option className="bg-black">Not sure yet</option>
        </select>
      </label>
      <label className="grid gap-1.5 text-sm font-medium text-white/80">
        Location
        <input className={fieldClass} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="City or zip" autoComplete="postal-code" />
      </label>
      <label className="grid gap-1.5 text-sm font-medium text-white/80">
        Preferred date
        <input type="date" className={`${fieldClass} [color-scheme:dark]`} value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="grid gap-1.5 text-sm font-medium text-white/80 sm:col-span-2">
        Anything else?
        <textarea className={`${fieldClass} min-h-24`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Pet hair, stains, odors, condition of paint…" />
      </label>
      <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row">
        <a
          href={smsHref}
          className="bg-gold inline-flex h-14 flex-1 items-center justify-center gap-2 rounded-md px-6 font-bold uppercase tracking-wider text-black transition hover:brightness-110"
        >
          <MessageSquare className="size-5" /> Text my request
        </a>
        <a
          href={mailHref}
          className="inline-flex h-14 flex-1 items-center justify-center gap-2 rounded-md border border-[#d4a843] px-6 font-bold uppercase tracking-wider text-[#f0c75e] transition hover:bg-[#d4a843]/10"
        >
          <Mail className="size-5" /> Email instead
        </a>
      </div>
      <p className="text-xs text-white/50 sm:col-span-2">
        Opens your messages or email app with your details filled in — just hit send.
      </p>
    </form>
  );
}
