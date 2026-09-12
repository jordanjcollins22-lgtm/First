"use client";

import { useRef, useState, useTransition } from "react";
import { Check, Loader2, Lock, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  artworkKindBlurb,
  artworkKindLabel,
  artworkKindPromise,
  checkArtwork,
  isSoldOut,
  money,
  offerStats,
  availabilityLine,
  type ArtworkCheck,
  type ArtworkKind,
} from "@/lib/flyer-offer";
import {
  createArtworkUpload,
  payForFlyerSpot,
  startFlyerBooking,
} from "@/lib/actions/public-flyer-actions";
import { createClient } from "@/lib/supabase/client";
import type { PublicFlyerRun } from "@/lib/data/public-flyer";
import { FlyerSheetPreview, type SheetAd } from "@/components/flyer/sheet-preview";

/**
 * The whole funnel: what it is, upload, look at it, pay.
 *
 * One page, in the order somebody decides things. A local business is not
 * going to make an account or come back tomorrow, so anything costing a
 * return visit costs the sale.
 */
export function FlyerFunnel({
  run,
  slug,
  sheetAds = [],
}: {
  run: PublicFlyerRun;
  slug: string;
  /** What is already printed on the sheet, so the mock-up is the real flyer. */
  sheetAds?: SheetAd[];
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();

  const [businessName, setBusinessName] = useState("");
  const [phone, setPhone] = useState("");

  // The preview, and the file itself. The preview is a data URL for the
  // browser to draw; the file goes straight to storage without passing
  // through the app.
  const [artwork, setArtwork] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState("");
  const [check, setCheck] = useState<ArtworkCheck | null>(null);
  const [kind, setKind] = useState<ArtworkKind>("ready");
  const [error, setError] = useState<string | null>(null);

  const soldOut = isSoldOut(run.taken);
  const stats = offerStats();

  async function onFile(chosen: File) {
    setError(null);
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.readAsDataURL(chosen);
    });

    // Measured in the browser, because the only way to tell somebody their
    // design will print soft is to look at it before they pay for it.
    const size = await new Promise<{ width: number | null; height: number | null }>((resolve) => {
      if (chosen.type === "application/pdf") return resolve({ width: null, height: null });
      const img = new window.Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({ width: null, height: null });
      img.src = dataUrl;
    });

    // A reference is not going to print, so its resolution is not a fault.
    // Warning somebody their own photo is too small to print is how they
    // abandon a form that was about to take their money.
    const verdict =
      kind === "reference"
        ? checkArtwork({ type: chosen.type, bytes: chosen.size, width: null, height: null })
        : checkArtwork({ type: chosen.type, bytes: chosen.size, ...size });
    setCheck(verdict);
    if (verdict.verdict === "reject") {
      setArtwork(null);
      return;
    }
    setArtwork(dataUrl);
    setFile(chosen);
    setFileType(chosen.type);
  }

  function approveAndPay() {
    if (!file) return;
    setError(null);
    start(async () => {
      // Straight to storage. Sending the file through the action put it in a
      // one megabyte request body, which is smaller than most photographs
      // taken on a phone.
      const slotForFile = await createArtworkUpload({ orgSlug: slug, fileType });
      if (!slotForFile.ok) {
        setError(slotForFile.message);
        return;
      }

      const uploaded = await createClient()
        .storage.from("flyer-ads")
        .uploadToSignedUrl(slotForFile.path, slotForFile.token, file, {
          contentType: fileType,
        });
      if (uploaded.error) {
        setError("That file would not upload. Try a smaller one, or send it to us directly.");
        return;
      }

      const booked = await startFlyerBooking({
        orgSlug: slug,
        businessName,
        phone,
        imagePath: slotForFile.path,
        artworkKind: kind,
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

  const ready = businessName.trim().length > 0 && Boolean(file);
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
        {availabilityLine(run.taken)}
        {mailsOnLabel && ` Goes out ${mailsOnLabel}.`}
      </p>

      {soldOut ? (
        <p className="rounded-xl border border-border p-4 text-center text-sm text-muted-foreground">
          Every spot on this run is taken. Get in touch and we will hold you one on the next.
        </p>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Your advert</h2>

            {/* Two ways in, offered as plainly as each other. Most local
                businesses do not have a print-ready file, and a form that
                only accepts one loses them at the last step. */}
            <div className="flex flex-col gap-2">
              {(["ready", "reference"] as ArtworkKind[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setKind(option);
                    setCheck(null);
                  }}
                  className={`flex items-start gap-2.5 rounded-xl border p-3 text-left ${
                    kind === option ? "border-primary bg-primary/5" : "border-border"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                      kind === option ? "border-primary" : "border-muted-foreground/40"
                    }`}
                  >
                    {kind === option && <span className="h-2 w-2 rounded-full bg-primary" />}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold">{artworkKindLabel(option)}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {artworkKindBlurb(option)}
                    </span>
                  </span>
                </button>
              ))}
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
            {/* Compact until there is something in it. At the tile's real
                shape an empty box is taller than a phone screen, so the page
                opens with a dashed rectangle where the sales pitch should be.
                Once they have uploaded it goes to the printed shape, because
                then the shape is the thing they are judging. */}
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className={`flex w-full items-center justify-center overflow-hidden rounded-xl border-2 border-dashed bg-muted/20 ${
                artwork
                  ? "aspect-[4/4.75] border-primary/40"
                  : "h-32 border-border hover:border-primary/50 hover:bg-primary/5"
              }`}
            >
              {artwork && fileType !== "application/pdf" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={artwork}
                  alt="Your advert"
                  className={`h-full w-full ${kind === "reference" ? "object-contain p-2" : "object-cover"}`}
                />
              ) : artwork ? (
                <span className="flex flex-col items-center gap-1 text-sm text-muted-foreground">
                  <Check className="h-6 w-6 text-primary" />
                  PDF ready
                </span>
              ) : (
                <span className="flex flex-col items-center gap-1.5 px-4 text-center">
                  <Upload className="h-6 w-6 text-primary" />
                  <span className="text-sm font-semibold">
                    {kind === "ready" ? "Upload your advert" : "Upload your reference"}
                  </span>
                  <span className="text-xs text-muted-foreground">PNG, JPG or PDF</span>
                </span>
              )}
            </button>

            {artwork && (
              <p className="text-xs font-medium text-primary">{artworkKindPromise(kind)}</p>
            )}

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
                Upload a different file
              </button>
            )}
          </section>

          {/* On the actual sheet. A tile floating on its own tells somebody
              nothing about what a neighbour will see, and this is the moment
              the sale is made or lost. */}
          <section className="flex flex-col gap-2 rounded-xl border border-border bg-muted/20 p-4">
            <h2 className="text-center text-sm font-semibold">
              {artwork && kind === "ready" ? "Here it is on the flyer" : "Where your advert goes"}
            </h2>
            <FlyerSheetPreview
              // A reference is not the advert, so showing it in the square
              // would be showing them something that will never print.
              artwork={kind === "reference" ? null : artwork}
              businessName={businessName}
              isPdf={fileType === "application/pdf"}
              ads={sheetAds}
            />
          </section>

          {/* Two boxes. Every extra field on a form somebody fills in on a
              phone between jobs is a chance to put it down and not come back,
              and Stripe collects the rest at the card form anyway. */}
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">Who is it for?</h2>
            <Input
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="Business name"
            />
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Best number to reach you"
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
