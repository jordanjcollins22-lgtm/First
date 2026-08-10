"use client";

import { Loader2, MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { env } from "@/lib/env";
import type { GeocodeSuggestion } from "@/lib/mapbox-geocoding";

interface PropertyConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestion: GeocodeSuggestion;
  customerName: string;
  onConfirm: () => void;
  isPending: boolean;
}

export function PropertyConfirmDialog({
  open,
  onOpenChange,
  suggestion,
  customerName,
  onConfirm,
  isPending,
}: PropertyConfirmDialogProps) {
  const imageUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/pin-s+ff3b30(${suggestion.lng},${suggestion.lat})/${suggestion.lng},${suggestion.lat},19,0/480x320@2x?access_token=${env.mapboxToken}`;

  return (
    <Dialog open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm this property</DialogTitle>
          <DialogDescription>
            Check that the pin is on the right house before creating the estimate.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-hidden rounded-lg border border-border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt="Satellite view of the selected address with a pin on the property"
            className="h-64 w-full object-cover"
          />
        </div>

        <div className="flex items-start gap-2 text-sm">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="font-medium">{customerName}</p>
            <p className="text-muted-foreground">{suggestion.fullAddress}</p>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Search again
          </Button>
          <Button type="button" onClick={onConfirm} disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Creating...
              </>
            ) : (
              "This is the right property"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
