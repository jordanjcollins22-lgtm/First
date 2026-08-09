"use client";

import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addServiceMaterialRule } from "@/lib/actions/material-actions";
import type { ServiceTypeDef } from "@/components/canvas/service-catalog";
import type { Material } from "@/types/domain";

interface AddMaterialRuleFormProps {
  materials: Material[];
  serviceTypes: ServiceTypeDef[];
}

export function AddMaterialRuleForm({ materials, serviceTypes }: AddMaterialRuleFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [materialId, setMaterialId] = useState(materials[0]?.id ?? "");
  const [serviceTypeId, setServiceTypeId] = useState(serviceTypes[0]?.id ?? "");
  const [isPending, startTransition] = useTransition();

  const selectedServiceType = serviceTypes.find((t) => t.id === serviceTypeId);

  function handleSubmit(formData: FormData) {
    formData.set("material_id", materialId);
    formData.set("service_type_id", serviceTypeId);
    startTransition(async () => {
      await addServiceMaterialRule(formData);
      formRef.current?.reset();
    });
  }

  if (materials.length === 0) {
    return <p className="text-sm text-muted-foreground">Add a material above before creating rules.</p>;
  }

  return (
    <form ref={formRef} action={handleSubmit} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Material</Label>
          <Select value={materialId} onValueChange={setMaterialId}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {materials.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Applies to service</Label>
          <Select value={serviceTypeId} onValueChange={setServiceTypeId}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {serviceTypes.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="match_field">Only when field (optional)</Label>
          <Input id="match_field" name="match_field" placeholder="e.g. material" className="w-36" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="match_value">equals value</Label>
          <Input id="match_value" name="match_value" placeholder="e.g. Mulch" className="w-32" />
        </div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Adding..." : "Add Rule"}
        </Button>
      </div>
      {selectedServiceType && (
        <p className="text-xs text-muted-foreground">
          Fields for {selectedServiceType.label}: {selectedServiceType.fields.map((f) => f.key).join(", ")}
        </p>
      )}
    </form>
  );
}
