"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Filters } from "@/lib/transactions";

/**
 * Narrowing the list, in the URL.
 *
 * The filters live in the address rather than in component state so a view can
 * be reloaded, bookmarked and sent to somebody. "Everything at Home Depot
 * since June" is a thing one person wants to show another, and a screen that
 * loses it on refresh is a screen where that conversation happens by
 * screenshot.
 */
export function TransactionFilters({
  filters,
  accounts,
  categories,
  showing,
  everything,
}: {
  filters: Filters;
  accounts: { id: string; name: string }[];
  categories: { value: string; label: string }[];
  showing: number;
  everything: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState(filters.query);

  // Typed searches are debounced into the URL rather than pushed on every
  // keystroke, which would put thirty entries in the back button for one word.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (query === filters.query) return;
      set("q", query || null);
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function set(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value == null || value === "") next.delete(key);
    else next.set(key, value);
    const search = next.toString();
    router.replace(search ? `/admin/transactions?${search}` : "/admin/transactions", {
      scroll: false,
    });
  }

  const narrowed = showing !== everything;

  return (
    <div className="flex flex-col gap-2">
      <label className="relative flex items-center">
        <Search className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search a merchant, an account, a category…"
          className="h-11 w-full rounded-md border border-input bg-background pl-9 pr-9 text-base"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              set("q", null);
            }}
            className="absolute right-3 text-muted-foreground"
            aria-label="Clear the search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </label>

      <div className="flex flex-wrap gap-1.5">
        <Chip on={filters.direction === "out"} onClick={() => set("direction", filters.direction === "out" ? null : "out")}>
          Money out
        </Chip>
        <Chip on={filters.direction === "in"} onClick={() => set("direction", filters.direction === "in" ? null : "in")}>
          Money in
        </Chip>
        <Chip on={filters.recurringOnly} onClick={() => set("recurring", filters.recurringOnly ? null : "1")}>
          Comes back monthly
        </Chip>

        <select
          value={filters.accountId ?? ""}
          onChange={(event) => set("account", event.target.value || null)}
          className="h-9 rounded-full border border-border bg-background px-3 text-xs"
        >
          <option value="">Every account</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>

        <select
          value={filters.category ?? ""}
          onChange={(event) => set("category", event.target.value || null)}
          className="h-9 rounded-full border border-border bg-background px-3 text-xs"
        >
          <option value="">Every category</option>
          {categories.map((category) => (
            <option key={category.value} value={category.value}>
              {category.label}
            </option>
          ))}
        </select>

        <input
          type="date"
          value={filters.from ?? ""}
          onChange={(event) => set("from", event.target.value || null)}
          className="h-9 rounded-full border border-border bg-background px-3 text-xs"
          aria-label="From"
        />
        <input
          type="date"
          value={filters.to ?? ""}
          onChange={(event) => set("to", event.target.value || null)}
          className="h-9 rounded-full border border-border bg-background px-3 text-xs"
          aria-label="To"
        />
      </div>

      <p className="text-xs text-muted-foreground">
        {narrowed
          ? `${showing.toLocaleString()} of ${everything.toLocaleString()} transactions`
          : `All ${everything.toLocaleString()} transactions`}
        {narrowed && (
          <>
            {" · "}
            <button
              type="button"
              onClick={() => {
                setQuery("");
                router.replace("/admin/transactions", { scroll: false });
              }}
              className="underline"
            >
              Show everything
            </button>
          </>
        )}
      </p>
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-9 rounded-full border px-3 text-xs",
        on
          ? "border-primary bg-primary/10 font-medium text-primary"
          : "border-border text-muted-foreground hover:bg-accent"
      )}
    >
      {children}
    </button>
  );
}
