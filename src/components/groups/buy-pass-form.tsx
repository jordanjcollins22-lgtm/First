"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { buyGroupPass } from "@/lib/actions/public-group-pass-actions";

/**
 * Four boxes and a card form.
 *
 * Anything more is a form a busy tradesperson abandons. The email is the only
 * one that has to be right, because the code goes to it.
 */
export function BuyPassForm({ groupId }: { groupId: string }) {
  const [businessName, setBusinessName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    start(async () => {
      const result = await buyGroupPass({ groupId, businessName, contactName, email, phone });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      window.location.href = result.url;
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field label="Business name" value={businessName} onChange={setBusinessName} required />
      <Field label="Your name" value={contactName} onChange={setContactName} />
      <Field label="Email" value={email} onChange={setEmail} type="email" required />
      <Field label="Phone" value={phone} onChange={setPhone} type="tel" />

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={pending} className="mt-1">
        {pending ? "Opening the card form…" : "Pay and get my code"}
      </Button>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">
        {label}
        {required ? "" : " (optional)"}
      </span>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-input bg-background px-3 py-2 text-base"
      />
    </label>
  );
}
