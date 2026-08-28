"use client";

import { useRef, useState, useTransition } from "react";
import { Check, Loader2, Lock, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  checkArtwork,
  isSoldOut,
  money,
  offerStats,
  specLine,
  spotsLabel,
  type ArtworkCheck,
} from "@/lib/flyer-offer";
import { startFlyerBooking, payForFlyerSpot } from "@/lib/actions/public-flyer-actions";
import type { PublicFlyerRun } from "@/lib/data/public-flyer";
import { FlyerSheetPreview } from "@/components/flyer/sheet-preview";

/**
 * The whole funnel: what it is, upload, look at it, pay.
 *
 * One page, in the order somebody decides things. A local business is not
 * going to make an account or come back tomorrow, so anything costing a
 * return visit costs the sale.
 */
export function FlyerFunnel({ run, slug }: { run: PublicFlyerRun; slug: string }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();

  const [businessName, setBusinessName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [artwork, setArtwork] = useState<string | null>(null);
  const [fileType, setFileType] = useState("");
  const [check, setCheck] = useState<ArtworkCheck | null>(null);
  const [error, setError] = useState<string | null>(null);

  const soldOut = isSoldOut(run.taken);
  const stats = offerStats();

  async function onFile(file: File) {
    setError(null);
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.readAsDataURL(file);
    });

    // Measured in the browser, because the only way to tell somebody their
    // design will print soft is to look at it before they pay for it.
    const size = await new Promise<{ width: number | null; height: number | null }>((resolve) => {
      if (file.type === "application/pdf") return resolve({ width: null, height: null });
      const img = new window.Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({ width: null, height: null });
      img.src = dataUrl;
    });

    const verdict = checkArtwork({ type: file.type, bytes: file.size, ...size });
    setCheck(verdict);
    if (verdict.verdict === "reject") {
      setArtwork(null);
      return;
    }
    setArtwork(dataUrl);
    setFileType(file.type);
  }

  function approveAndPay() {
    if (!artwork) return;
    setError(null);
    start(async () => {
      const booked = await startFlyerBooking({
        orgSlug: slug,
        businessName,
        contactName,
        email,
        phone,
        artwork,
        fileType,
      });
      if (!booked.ok) {
        setError(booked.message);
        return;
      }
      const paid = await payForFlyerSpot({ token: booked.token });
      if (!paid.ok) {
        setError(paid.message);
        return;
      }
      window.location.href = paid.url;
    });
  }

  const ready = businessName.trim().length > 0 && Boolean(artwork);
  const mailsOnLabel = run.mailsOn
    ? new Date(`${run.mailsOn}T12:00:00Z`).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      })
    : null;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-8">
      <header className="text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">
          {run.organizationName}
        </p>
        <h1 className="mt-1 text-3xl font-bold leading-tight">
          Put your advert in front of {run.flyerCount.toLocaleString()} local homes
        </h1>
        <p className="mt-2 text-muted-foreground">
          We mail {run.flyerCount.toLocaleString()} flyers around here. One of the spots on it can
          be yours for {money(run.spotPriceCents)}.
        </p>
      </header>

      {/* Numbers, not claims. Every one is arithmetic on our own figures, so
          none of it is a promise we cannot keep. */}
      <div className="grid grid-cols-3 gap-2">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-card/60 p-3 text-center">
            <p className="text-xl font-bold text-primary">{stat.value}</p>
            <p className="text-[11px] font-medium">{stat.label}</p>
          </div>
        ))}
      </div>

      <p className="rounded-lg bg-muted/40 p-3 text-center text-sm">
        {spotsLabel(run.taken)}
        {mailsOnLabel && ` Goes out ${mailsOnLabel}.`}
      </p>

      {soldOut ? (
        <p className="rounded-xl border border-border p-4 text-center text-sm text-muted-foreground">
          Every spot on this run is taken. Get in touch and we will hold you one on the next.
        </p>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-lg font-semibold">Send us your design</h2>
              <p className="text-xs text-muted-foreground">{specLine()}</p>
            </div>

            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,application/pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
              }}
            />

            {/* The tile at the shape it actually prints, so what they approve
                here is what lands on the doormat. */}
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex aspect-[4/4.75] w-full items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-border bg-muted/20"
            >
              {artwork && fileType !== "application/pdf" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={artwork} alt="Your advert" className="h-full w-full object-cover" />
              ) : artwork ? (
                <span className="flex flex-col items-center gap-1 text-sm text-muted-foreground">
                  <Check className="h-6 w-6 text-primary" />
                  PDF ready
                </span>
              ) : (
                <span className="flex flex-col items-center gap-1 text-sm text-muted-foreground">
                  <Upload className="h-6 w-6" />
                  Tap to upload your design
                </span>
              )}
            </button>

            {check && (
              <p
                className={`text-xs ${
                  check.verdict === "ok"
                    ? "text-emerald-700"
                    : check.verdict === "warn"
                      ? "text-amber-700"
                      : "text-destructive"
                }`}
              >
                {check.message}
              </p>
            )}
            {artwork && (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="text-xs font-medium text-primary underline"
              >
                Use a different design
              </button>
            )}
          </section>

          {/* On the actual sheet. A tile floating on its own tells somebody
              nothing about what a neighbour will see, and this is the moment
              the sale is made or lost. */}
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">How it will look</h2>
            <FlyerSheetPreview
              artwork={artwork}
              businessName={businessName}
              isPdf={fileType === "application/pdf"}
            />
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">Who is it for?</h2>
            <Input
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="Business name"
            />
            <Input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Your name (optional)"
            />
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email for the receipt (optional)"
              type="email"
            />
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone (optional)"
              type="tel"
            />
          </section>

          <Button
            type="button"
            size="xl"
            className="w-full"
            disabled={!ready || pending}
            onClick={approveAndPay}
          >
            {pending ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Opening secure checkout…
              </>
            ) : (
              `Approve and pay ${money(run.spotPriceCents)}`
            )}
          </Button>

          {!ready && (
            <p className="-mt-4 text-center text-xs text-muted-foreground">
              Upload your design and tell us the business name.
            </p>
          )}
          {error && <p className="text-center text-sm text-destructive">{error}</p>}

          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5" />
            Card, Apple Pay and Google Pay, handled by Stripe.
          </p>
        </>
      )}
    </div>
  );
}
