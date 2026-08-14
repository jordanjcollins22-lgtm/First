"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateProfilePay } from "@/lib/actions/team-actions";

type PayType = "hourly" | "commission" | "both";

export function PayRateInput({
  profileId,
  initialPayType,
  initialRate,
  initialCommissionPct,
}: {
  profileId: string;
  initialPayType: PayType;
  initialRate: number | null;
  initialCommissionPct: number | null;
}) {
  const [payType, setPayType] = useState<PayType>(initialPayType);
  const [rate, setRate] = useState(initialRate?.toString() ?? "");
  const [commission, setCommission] = useState(initialCommissionPct?.toString() ?? "");
  const [isPending, startTransition] = useTransition();

  function save(nextPayType: PayType, nextRate: string, nextCommission: string) {
    startTransition(() =>
      updateProfilePay(
        profileId,
        nextPayType,
        nextPayType !== "commission" && nextRate.trim() ? Number(nextRate) : null,
        nextPayType !== "hourly" && nextCommission.trim() ? Number(nextCommission) : null
      )
    );
  }

  const showHourly = payType === "hourly" || payType === "both";
  const showCommission = payType === "commission" || payType === "both";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select
        value={payType}
        onValueChange={(v) => {
          const next = v as PayType;
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
          <SelectItem value="both">Both</SelectItem>
        </SelectContent>
      </Select>
      {showHourly && (
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
      )}
      {showCommission && (
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
