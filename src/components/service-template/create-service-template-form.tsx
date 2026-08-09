"use client";

import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createServiceTemplate } from "@/lib/actions/service-template-actions";
import type { GeometryType, MeasurementType } from "@/types/domain";

const GEOMETRY_OPTIONS: GeometryType[] = ["Polygon", "LineString", "Point"];

export function CreateServiceTemplateForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [geometryTypes, setGeometryTypes] = useState<GeometryType[]>(["Polygon"]);
  const [measurementType, setMeasurementType] = useState<MeasurementType>("area");
  const [isPending, startTransition] = useTransition();

  function toggleGeometry(type: GeometryType) {
    setGeometryTypes((prev) =>
      prev.includes(type) ? prev.filter((g) => g !== type) : [...prev, type]
    );
  }

  function handleSubmit(formData: FormData) {
    geometryTypes.forEach((g) => formData.append("allowed_geometry_types", g));
    startTransition(async () => {
      await createServiceTemplate(formData);
      formRef.current?.reset();
      setGeometryTypes(["Polygon"]);
    });
  }

  return (
    <form ref={formRef} action={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" required placeholder="Mulch Renovation" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="required_photo_count">Required photo count</Label>
          <Input
            id="required_photo_count"
            name="required_photo_count"
            type="number"
            min={0}
            defaultValue={2}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" name="description" rows={2} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Allowed shapes</Label>
        <div className="flex gap-4">
          {GEOMETRY_OPTIONS.map((g) => (
            <label key={g} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={geometryTypes.includes(g)}
                onCheckedChange={() => toggleGeometry(g)}
              />
              {g}
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="required_measurement_type">Measurement type</Label>
        <Select
          value={measurementType}
          onValueChange={(v) => setMeasurementType(v as MeasurementType)}
        >
          <SelectTrigger className="max-w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="area">Area (sq ft)</SelectItem>
            <SelectItem value="length">Length (linear ft)</SelectItem>
            <SelectItem value="count">Count</SelectItem>
          </SelectContent>
        </Select>
        {/* Radix Select doesn't submit a native form value on its own */}
        <input type="hidden" name="required_measurement_type" value={measurementType} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="crew_steps">Crew steps (one per line)</Label>
        <Textarea id="crew_steps" name="crew_steps" rows={4} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tools_required">Tools (one per line)</Label>
          <Textarea id="tools_required" name="tools_required" rows={3} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="equipment_required">Equipment (one per line)</Label>
          <Textarea id="equipment_required" name="equipment_required" rows={3} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="quality_control_requirements">
          Quality control requirements (one per line)
        </Label>
        <Textarea id="quality_control_requirements" name="quality_control_requirements" rows={3} />
      </div>

      <Button type="submit" disabled={isPending} className="self-start">
        {isPending ? "Saving..." : "Add Service Template"}
      </Button>
    </form>
  );
}
