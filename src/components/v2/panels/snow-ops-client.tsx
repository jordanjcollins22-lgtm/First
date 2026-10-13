"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  addSnowContractClient,
  billSnowEventNow,
  closeSnowEventAction,
  dismissSnowSuggestion,
  saveSnowContract,
  saveSnowSettings,
  startSnowEventAction,
  type SnowActionResult,
  type SnowContractInput,
} from "@/lib/actions/snow-actions";
import { CONTRACT_LABEL, CONTRACT_TYPES, type ContractType } from "@/lib/snow/billing";

/** The snow panel's buttons and forms. */

type Result = SnowActionResult<unknown> | null;

function Status({ result }: { result: Result }) {
  if (!result) return null;
  return (
    <p role="status" className={`text-sm ${result.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}>
      {result.ok ? result.message : result.error}
    </p>
  );
}

export function StartEventButtons({ disabled }: { disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result>(null);
  const go = (service: "pretreat" | "salt" | "plow") => start(async () => setResult(await startSnowEventAction({ service })));
  return (
    <div className="grid gap-2">
      <div className="grid gap-2 sm:grid-cols-3">
        <Button className="min-h-11" disabled={pending || disabled} onClick={() => go("salt")}>
          Start: salt
        </Button>
        <Button className="min-h-11" disabled={pending || disabled} onClick={() => go("plow")}>
          Start: plow and salt
        </Button>
        <Button variant="secondary" className="min-h-11" disabled={pending || disabled} onClick={() => go("pretreat")}>
          Start: pre-treat
        </Button>
      </div>
      <Status result={result} />
    </div>
  );
}

export function SuggestionActions({ id, service, disabled }: { id: string; service: "salt" | "plow" | "pretreat"; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result>(null);
  return (
    <div className="mt-2 grid gap-2">
      <div className="flex flex-wrap gap-2">
        <Button className="min-h-11" disabled={pending || disabled} onClick={() => start(async () => setResult(await startSnowEventAction({ service, suggestionId: id })))}>
          Start it
        </Button>
        <Button variant="secondary" className="min-h-11" disabled={pending} onClick={() => start(async () => setResult(await dismissSnowSuggestion(id)))}>
          Not needed
        </Button>
      </div>
      {disabled && <p className="text-xs text-muted-foreground">A storm is already running. Close it first.</p>}
      <Status result={result} />
    </div>
  );
}

export function CloseEventForm({ eventId, pending: left }: { eventId: string; pending: number }) {
  const [depth, setDepth] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result>(null);
  return (
    <div className="grid gap-2">
      <label className="grid gap-1 text-sm sm:max-w-xs">
        <span>Snow on the ground at the end (inches, optional)</span>
        <input type="number" inputMode="decimal" min={0} step={0.5} value={depth} onChange={(e) => setDepth(e.target.value)} className="min-h-11 rounded-lg border bg-background px-3" />
      </label>
      {left > 0 && <p className="text-xs text-muted-foreground">{left} stop{left === 1 ? " is" : "s are"} not logged yet. They won&apos;t be billed.</p>}
      <div>
        <Button
          className="min-h-11"
          disabled={pending}
          onClick={() => start(async () => setResult(await closeSnowEventAction(eventId, depth === "" ? null : Number(depth))))}
        >
          Close the storm and settle it
        </Button>
      </div>
      <Status result={result} />
    </div>
  );
}

export function BillNowButton({ eventId }: { eventId: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result>(null);
  return (
    <div className="grid gap-1">
      <div>
        <Button variant="secondary" size="sm" className="min-h-11" disabled={pending} onClick={() => start(async () => setResult(await billSnowEventNow(eventId)))}>
          Bill now
        </Button>
      </div>
      <Status result={result} />
    </div>
  );
}

export interface ContractView {
  id: string;
  name: string;
  address: string;
  onRoute: boolean;
  missingRate: boolean;
  left: number | null;
  contractType: ContractType;
  ratePerPush: number | null;
  ratePerApplication: number | null;
  ratePerEvent: number | null;
  seasonalPrice: number | null;
  triggerDepthIn: number | null;
  areaSqft: number | null;
  includesPlowing: boolean;
  routeOrder: number | null;
}

function ContractFields({ value, onChange }: { value: SnowContractInput; onChange: (v: SnowContractInput) => void }) {
  const field = (key: keyof SnowContractInput, label: string, step = 1) => (
    <label className="grid gap-1 text-sm">
      <span>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step={step}
        value={value[key] == null ? "" : String(value[key])}
        onChange={(e) => onChange({ ...value, [key]: e.target.value === "" ? null : Number(e.target.value) })}
        className="min-h-11 rounded-lg border bg-background px-3"
      />
    </label>
  );
  const t = value.contractType;
  return (
    <div className="grid gap-3">
      <label className="grid gap-1 text-sm">
        <span>Contract</span>
        <select
          value={t}
          onChange={(e) => onChange({ ...value, contractType: e.target.value as ContractType })}
          className="min-h-11 rounded-lg border bg-background px-3"
        >
          {CONTRACT_TYPES.map((c) => (
            <option key={c} value={c}>
              {CONTRACT_LABEL[c]}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        {t === "per_push" && field("ratePerPush", "Rate per push ($)", 5)}
        {t === "per_application" && field("ratePerApplication", "Rate per application ($)", 5)}
        {t === "per_event" && field("ratePerEvent", "Rate per event ($)", 5)}
        {t === "seasonal" && field("seasonalPrice", "Seasonal price ($)", 50)}
        {field("triggerDepthIn", "Plow from (inches)", 0.5)}
        {field("areaSqft", "Paved area (sq ft)", 100)}
        {field("routeOrder", "Position on the route (blank: by distance)")}
      </div>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" className="h-5 w-5" checked={value.includesPlowing} onChange={(e) => onChange({ ...value, includesPlowing: e.target.checked })} />
        Includes plowing
      </label>
    </div>
  );
}

export function ContractEditor({ client }: { client: ContractView }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<SnowContractInput>({
    contractType: client.contractType,
    ratePerPush: client.ratePerPush,
    ratePerApplication: client.ratePerApplication,
    ratePerEvent: client.ratePerEvent,
    seasonalPrice: client.seasonalPrice,
    triggerDepthIn: client.triggerDepthIn,
    areaSqft: client.areaSqft,
    includesPlowing: client.includesPlowing,
    routeOrder: client.routeOrder,
  });
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result>(null);
  return (
    <div className="grid gap-2">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-h-11 w-full flex-wrap items-baseline gap-x-2 text-left">
        <span className="text-sm font-medium">{client.name}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{CONTRACT_LABEL[client.contractType]}</span>
        {client.left != null && <span className="text-xs text-muted-foreground">{client.left} treatments left</span>}
        {client.missingRate && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">no rate</span>}
        {!client.onRoute && <span className="text-xs text-muted-foreground">not on the route</span>}
        <span className="w-full text-xs text-muted-foreground">{client.address}</span>
      </button>
      {open && (
        <div className="grid gap-3 rounded-lg bg-muted/50 p-3">
          <ContractFields value={value} onChange={setValue} />
          <div>
            <Button className="min-h-11" disabled={pending} onClick={() => start(async () => setResult(await saveSnowContract(client.id, value)))}>
              Save contract
            </Button>
          </div>
          <Status result={result} />
        </div>
      )}
    </div>
  );
}

export function AddContractClient({ customers }: { customers: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [value, setValue] = useState<SnowContractInput>({
    contractType: "per_push",
    ratePerPush: null,
    ratePerApplication: null,
    ratePerEvent: null,
    seasonalPrice: null,
    triggerDepthIn: 2,
    areaSqft: null,
    includesPlowing: true,
    routeOrder: null,
  });
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result>(null);
  if (!open) {
    return (
      <Button variant="secondary" className="min-h-11" onClick={() => setOpen(true)}>
        Add a contract client
      </Button>
    );
  }
  return (
    <div className="grid gap-3">
      <label className="grid gap-1 text-sm">
        <span>Client</span>
        <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="min-h-11 rounded-lg border bg-background px-3">
          <option value="">Pick a client…</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <ContractFields value={value} onChange={setValue} />
      <div className="flex flex-wrap gap-2">
        <Button className="min-h-11" disabled={pending || !customerId} onClick={() => start(async () => setResult(await addSnowContractClient({ ...value, customerId })))}>
          Add to the snow route
        </Button>
        <Button variant="secondary" className="min-h-11" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <Status result={result} />
    </div>
  );
}

export function SnowSettingsForm({
  ready,
  settings,
}: {
  ready: boolean;
  settings: { snowSuggestEnabled: boolean; snowTriggerIn: number; snowClientNotice: boolean; snowInvoicingEnabled: boolean };
}) {
  const [form, setForm] = useState(settings);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result>(null);
  const toggle = (key: "snowSuggestEnabled" | "snowClientNotice" | "snowInvoicingEnabled", label: string, hint: string) => (
    <label className="flex min-h-11 cursor-pointer items-start gap-3">
      <input type="checkbox" className="mt-1 h-5 w-5" checked={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
  return (
    <div className="grid gap-3 rounded-xl border bg-card p-4">
      <h3 className="text-sm font-semibold">Snow automations</h3>
      {toggle("snowSuggestEnabled", "Suggest a storm from the forecast", "Freezing rain, or any snow on a freezing day, puts a suggestion at the top of this panel and texts owners and leads. Nothing starts without a tap.")}
      <label className="grid gap-1 text-sm sm:max-w-xs">
        <span>Suggest plowing from (inches of snow)</span>
        <input
          type="number"
          inputMode="decimal"
          min={0.5}
          step={0.5}
          value={form.snowTriggerIn}
          onChange={(e) => setForm({ ...form, snowTriggerIn: Number(e.target.value) })}
          className="min-h-11 rounded-lg border bg-background px-3"
        />
      </label>
      {toggle("snowClientNotice", "Tell clients when their property was serviced", "\"Your property was serviced at 5:12 AM\", with a link to the photos. Storms started after this is switched on only.")}
      {toggle("snowInvoicingEnabled", "Bill contract clients when a storm closes", "Per push, per application or per event, through Stripe, with the photos linked. Seasonal and prepaid clients are never billed per storm.")}
      <div>
        <Button className="min-h-11" disabled={pending || !ready} onClick={() => start(async () => setResult(await saveSnowSettings(form)))}>
          Save
        </Button>
      </div>
      <Status result={result} />
    </div>
  );
}
