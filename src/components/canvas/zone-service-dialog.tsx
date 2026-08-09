"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { Camera, Trash2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ZoneService } from "./types";

const EMPTY_SERVICE: ZoneService = { name: "", trim: 0, remove: 0, plantNew: 0 };

interface ZoneServiceDialogProps {
  open: boolean;
  zoneName: string;
  initialService: ZoneService | null;
  initialPhoto: Blob | null;
  initialLocation: string;
  onSave: (service: ZoneService, photo: Blob | null, location: string) => void;
  onCancel: () => void;
}

export function ZoneServiceDialog({
  open,
  zoneName,
  initialService,
  initialPhoto,
  initialLocation,
  onSave,
  onCancel,
}: ZoneServiceDialogProps) {
  const [service, setService] = useState<ZoneService>(initialService ?? EMPTY_SERVICE);
  const [photo, setPhoto] = useState<Blob | null>(initialPhoto);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [location, setLocation] = useState(initialLocation);

  useEffect(() => {
    // Object URLs must be created/revoked alongside the blob's lifecycle, so this
    // is a real external-system sync, not derivable state.
    if (!photo) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPhotoUrl(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  function handleCountChange(field: "trim" | "remove" | "plantNew", value: string) {
    const parsed = Math.max(0, Number(value) || 0);
    setService((prev) => ({ ...prev, [field]: parsed }));
  }

  function handlePhotoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setPhoto(file);
    e.target.value = "";
  }

  function handleSave() {
    onSave(service, photo, location);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>What&apos;s being done in {zoneName}?</DialogTitle>
          <DialogDescription>
            Describe the service, note any plant work, and add a photo of the area.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="zone-location">Where is this zone located?</Label>
            <Input
              id="zone-location"
              placeholder="e.g. Front yard, near the driveway"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="service-name">Service</Label>
            <Input
              id="service-name"
              placeholder="e.g. Mulch bed cleanup"
              value={service.name}
              onChange={(e) => setService((prev) => ({ ...prev, name: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="service-trim">Trim</Label>
              <Input
                id="service-trim"
                type="number"
                min={0}
                value={service.trim}
                onChange={(e) => handleCountChange("trim", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="service-remove">Remove</Label>
              <Input
                id="service-remove"
                type="number"
                min={0}
                value={service.remove}
                onChange={(e) => handleCountChange("remove", e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="service-plant-new">Plant new</Label>
              <Input
                id="service-plant-new"
                type="number"
                min={0}
                value={service.plantNew}
                onChange={(e) => handleCountChange("plantNew", e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Drag plant markers from the sidebar onto this zone to mark exactly where the
            work happens.
          </p>

          <div className="flex flex-col gap-2">
            <Label>Area photo</Label>
            {photoUrl ? (
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoUrl}
                  alt=""
                  className="h-16 w-16 rounded-md border border-border object-cover"
                />
                <div className="flex flex-col items-start gap-1">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-primary hover:underline">
                    Replace photo
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={handlePhotoChange}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setPhoto(null)}
                    className="inline-flex items-center gap-1 text-sm text-destructive hover:underline"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-accent">
                <Camera className="h-4 w-4" />
                Add a photo of this area
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={handlePhotoChange}
                />
              </label>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
