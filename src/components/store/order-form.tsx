"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

import { SELECT_CLASS } from "@/components/team/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createMerchOrder } from "@/lib/actions/merch-actions";
import { BARCODE_FORMATS } from "@/lib/merch/formats";
import { formatCents } from "@/lib/merch/format";
import type { TemplateField } from "@/lib/merch/template";
import type { BarcodeFormat } from "@/types/domain";

import { DesignPreview } from "./design-preview";
import { useDesignPreview } from "./use-design-preview";

export function OrderForm({
  product,
  fields,
  teamMembers,
  initialPreviewSvg,
}: {
  product: { id: string; name: string; price_cents: number; barcode_format: BarcodeFormat };
  fields: TemplateField[];
  teamMembers: { id: string; name: string }[];
  initialPreviewSvg: string;
}) {
  const [barcodeValue, setBarcodeValue] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState(false);
  const [isPending, startTransition] = useTransition();

  const preview = useDesignPreview(
    barcodeValue ? { productId: product.id, barcodeValue, values } : null,
    initialPreviewSvg
  );
  const format = BARCODE_FORMATS.find((f) => f.value === product.barcode_format);

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await createMerchOrder(formData);
      setError(result.error ?? null);
      if (!result.error) setPlaced(true);
    });
  }

  if (placed) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/50 p-6">
        <p className="font-semibold">Order placed.</p>
        <p className="text-sm text-muted-foreground">
          A manager will approve it and send the print file to the vendor. The vendor makes it and ships it
          straight to the address you gave.
        </p>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/store">Back to store</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/store/orders">See orders</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
      <div className="flex flex-col gap-2 md:order-2">
        {preview.svg && <DesignPreview svg={preview.svg} alt={`${product.name} preview`} />}
        {barcodeValue && preview.error ? (
          <p className="text-sm text-destructive">{preview.error}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {barcodeValue ? "This is the exact file the vendor will print." : "Sample shown. Type your barcode to see yours."}
          </p>
        )}
      </div>

      <form action={handleSubmit} className="flex flex-col gap-4 md:order-1">
        <input type="hidden" name="product_id" value={product.id} />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="team_member_id">Who is this for?</Label>
          <select id="team_member_id" name="team_member_id" required className={SELECT_CLASS} defaultValue="">
            <option value="" disabled>
              Pick a team member
            </option>
            {teamMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="barcode_value">Barcode ({format?.label})</Label>
          <Input
            id="barcode_value"
            name="barcode_value"
            required
            value={barcodeValue}
            onChange={(e) => setBarcodeValue(e.target.value)}
            placeholder={format?.hint}
          />
        </div>

        {fields.map((field) => (
          <div key={field.key} className="flex flex-col gap-1.5">
            <Label htmlFor={`field_${field.key}`}>{field.label}</Label>
            <Input
              id={`field_${field.key}`}
              name={`field_${field.key}`}
              value={values[field.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
            />
          </div>
        ))}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="quantity">Quantity</Label>
          <Input
            id="quantity"
            name="quantity"
            type="number"
            min={1}
            max={500}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
            className="w-28"
          />
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-semibold">Ship to</legend>
          <Input name="ship_name" required placeholder="Full name" autoComplete="name" />
          <Input name="ship_address1" required placeholder="Street address" autoComplete="address-line1" />
          <Input name="ship_address2" placeholder="Apt, suite (optional)" autoComplete="address-line2" />
          <div className="grid grid-cols-[1fr_5rem_7rem] gap-2">
            <Input name="ship_city" required placeholder="City" autoComplete="address-level2" />
            <Input name="ship_state" required placeholder="ST" maxLength={2} autoComplete="address-level1" />
            <Input name="ship_zip" required placeholder="ZIP" autoComplete="postal-code" />
          </div>
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="notes">Notes (optional)</Label>
          <Textarea id="notes" name="notes" rows={2} />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex items-center gap-4">
          <Button type="submit" disabled={isPending}>
            {isPending ? "Placing order..." : "Place order"}
          </Button>
          <span className="text-sm text-muted-foreground">
            Total {formatCents(product.price_cents * quantity)}
          </span>
        </div>
      </form>
    </div>
  );
}
