"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { updateProfilePhone } from "@/lib/actions/team-actions";

export function PhoneInput({ profileId, initialPhone }: { profileId: string; initialPhone: string | null }) {
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [isPending, startTransition] = useTransition();

  return (
    <Input
      type="tel"
      value={phone}
      placeholder="(555) 555-5555"
      disabled={isPending}
      onChange={(e) => setPhone(e.target.value)}
      onBlur={() => startTransition(() => updateProfilePhone(profileId, phone))}
      className="h-9 w-36 text-sm"
    />
  );
}
