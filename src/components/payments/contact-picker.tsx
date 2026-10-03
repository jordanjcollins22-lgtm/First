"use client";

import { useEffect, useState } from "react";
import { Search, User } from "lucide-react";

import { searchContacts } from "@/lib/actions/received-payment-actions";
import type { SearchableContact } from "@/lib/payer-match";

/**
 * Finding one person, on a phone.
 *
 * One of these rather than one per screen: money gets filed against a contact
 * from three places now, and three search boxes that behave differently is
 * three things to learn.
 *
 * Debounced, because a request per keystroke is three requests for "joe" and
 * only the last is an answer anybody reads.
 */
export function ContactPicker({
  onPick,
  placeholder = "Search contacts by name, email or phone",
}: {
  onPick: (contact: SearchableContact) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  // The results and the term they answer, kept together so "still searching"
  // is read off the two rather than tracked as a third piece of state that
  // can disagree with them.
  const [results, setResults] = useState<{ term: string; contacts: SearchableContact[] }>({
    term: "",
    contacts: [],
  });
  const [error, setError] = useState<string | null>(null);

  const term = query.trim();
  const answered = results.term === term;
  const searching = term.length >= 2 && !answered;

  useEffect(() => {
    if (term.length < 2) return;

    let live = true;
    const timer = setTimeout(async () => {
      const found = await searchContacts(term);
      if (!live) return;
      if (found.ok) setResults({ term, contacts: found.contacts });
      else setError(found.message);
    }, 250);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [term]);

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-sm"
        />
      </div>

      {searching && <p className="text-xs text-muted-foreground">Searching…</p>}
      {!searching && term.length >= 2 && results.contacts.length === 0 && (
        <p className="text-xs text-muted-foreground">Nobody matching &ldquo;{term}&rdquo;.</p>
      )}

      {answered && results.contacts.length > 0 && (
        <ul className="space-y-1">
          {results.contacts.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onPick(c)}
                className="w-full rounded-md border border-border px-2 py-1.5 text-left text-xs font-semibold"
              >
                <span className="block truncate">{c.name ?? "Unnamed contact"}</span>
                <span className="block truncate text-[11px] font-normal text-muted-foreground">
                  {[c.email, c.phone].filter(Boolean).join(" · ") || "No email or phone on file"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
}

/** The contact once chosen, with a way to change it. */
export function ChosenContact({
  contact,
  onClear,
}: {
  contact: SearchableContact;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-2 py-1.5">
      <span className="flex min-w-0 items-center gap-1.5 text-sm">
        <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">{contact.name ?? "Unnamed contact"}</span>
      </span>
      <button
        type="button"
        onClick={onClear}
        className="shrink-0 text-xs font-semibold text-muted-foreground underline-offset-2 hover:underline"
      >
        Change
      </button>
    </div>
  );
}
