"use client";

import { useState } from "react";

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

interface ScaleCalibrationDialogProps {
  open: boolean;
  onConfirm: (feet: number) => void;
  onCancel: () => void;
}

export function ScaleCalibrationDialog({ open, onConfirm, onCancel }: ScaleCalibrationDialogProps) {
  const [feet, setFeet] = useState("");

  function handleConfirm() {
    const parsed = Number(feet);
    if (!parsed || parsed <= 0) return;
    onConfirm(parsed);
    setFeet("");
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set scale</DialogTitle>
          <DialogDescription>
            How many feet is the line you just drew? Zone measurements will be calculated
            from this.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="scale-feet">Real-world distance (feet)</Label>
          <Input
            id="scale-feet"
            type="number"
            min={0.1}
            step="any"
            autoFocus
            value={feet}
            onChange={(e) => setFeet(e.target.value)}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>Set Scale</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
