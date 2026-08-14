"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateProfilePay } from "@/lib/actions/team-actions";

export function PayRateInput({
  profileId,
  initialPayType,
  initialRate,
  initialCommissionPct,
}: {
  profileId: string;
  initialPayType: "hourly" | "commission";
  initialRate: number | null;
  initialCommissionPct: number | null;
}) {
  const [payType, setPayType] = useState<"hourly" | "commission">(initialPayType);
  const [rate, setRate] = useState(initialRate?.toString() ?? "");
  const [commission, setCommission] = useState(initialCommissionPct?.toString() ?? "");
  const [isPending, startTransition] = useTransition();

  function save(nextPayType: "hourly" | "commission", nextRate: string, nextCommission: string) {
    startTransition(() =>
      updateProfilePay(
        profileId,
        nextPayType,
        nextRate.trim() ? Number(nextRate) : null,
        nextCommission.trim() ? Number(nextCommission) : null
      )
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Select
        value={payType}
        onValueChange={(v) => {
          const next = v as "hourly" | "commission";
          setPayType(next);
          save(next, rate, commission);
        }}
      >
        <SelectTrigger className="h-9 w-32 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="hourly">Hourly</SelectItem>
          <SelectItem value="commission">Commission</SelectItem>
        </SelectContent>
      </Select>
      {payType === "hourly" ? (
        <Input
          type="number"
          step="0.01"
          min={0}
          placeholder="$/hr"
          value={rate}
          disabled={isPending}
          onChange={(e) => setRate(e.target.value)}
          onBlur={() => save(payType, rate, commission)}
          className="h-9 w-24 text-sm"
        />
      ) : (
        <div className="flex items-center gap-1">
          <Input
            type="number"
            step="0.1"
            min={0}
            max={100}
            placeholder="%"
            value={commission}
            disabled={isPending}
            onChange={(e) => setCommission(e.target.value)}
            onBlur={() => save(payType, rate, commission)}
            className="h-9 w-20 text-sm"
          />
          <span className="text-xs text-muted-foreground">% of sale</span>
        </div>
      )}
    </div>
  );
}
