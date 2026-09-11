"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

import { setBusinessDetails } from "@/lib/actions/business-actions";

/**
 * What the business prints at the top of a document.
 *
 * Four lines and a logo. Stored once here and read by every receipt after,
 * because a phone number typed into each document is wrong on half of them
 * within a year. Everything is optional and a blank line is left off the
 * document rather than printed as an empty label.
 */
export function BusinessDetailsPanel({
  initial,
}: {
  initial: { phone: string; email: string; address: string; website: string; logoPath: string };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [phone, setPhone] = useState(initial.phone);
  const [email, setEmail] = useState(initial.email);
  const [address, setAddress] = useState(initial.address);
  const [website, setWebsite] = useState(initial.website);
  const [logoPath, setLogoPath] = useState(initial.logoPath);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    setSaved(false);
    start(async () => {
      const result = await setBusinessDetails({ phone, email, address, website, logoPath });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <p className="text-sm text-muted-foreground">
        Printed at the top of every receipt. Leave a line blank and it is left off rather than
        printed empty.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="biz-phone" label="Phone" value={phone} onChange={setPhone} placeholder="(410) 555-0100" autoComplete="tel" />
        <Field id="biz-email" label="Email" value={email} onChange={setEmail} placeholder="hello@jslandscapingmd.com" autoComplete="email" type="email" />
        <Field id="biz-website" label="Website" value={website} onChange={setWebsite} placeholder="jslandscapingmd.com" autoComplete="url" />
        <Field id="biz-logo" label="Logo" value={logoPath} onChange={setLogoPath} placeholder="/logo.png or a full https:// link" />
      </div>
      <label htmlFor="biz-address" className="flex flex-col gap-1">
        <span className="text-xs font-medium">Address, one line per line</span>
        <textarea
          id="biz-address"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          rows={3}
          placeholder={"123 Main Street\nBel Air, MD 21014"}
          className="rounded-md border border-border bg-background p-2 text-sm"
        />
      </label>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {saved ? <Check className="h-4 w-4" /> : null}
          {pending ? "Saving…" : saved ? "Saved" : "Save"}
        </button>
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  autoComplete,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  type?: string;
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1">
      <span className="text-xs font-medium">{label}</span>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="h-9 rounded-md border border-border bg-background px-2 text-sm"
      />
    </label>
  );
}
