"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Suggestion = { id: string; name: string; status: string; plans: string[]; detail?: string };

// Member search with a dropdown of matches as you type ("paige" lists every
// Paige). Pick one to open their page; Enter without a pick shows the full
// results list.
export type MemberSuggestion = Suggestion;

export function MemberSearch({
  initialQuery,
  compact = false,
  endpoint = "/api/memberships/search",
  onPick,
  onSubmitQuery,
  placeholder,
  ariaLabel,
  autoFocus,
}: {
  initialQuery: string;
  compact?: boolean;
  endpoint?: string;
  // When given, picking someone calls this instead of opening their page.
  onPick?: (suggestion: Suggestion) => void;
  // Enter with nothing highlighted (e.g. a scanner typing a card number).
  onSubmitQuery?: (query: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const latest = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep letters typed before the page finished loading.
  useEffect(() => {
    const typed = inputRef.current?.value ?? "";
    if (typed && typed !== initialQuery) {
      setQuery(typed);
      setOpen(true);
    }
  }, [initialQuery]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const request = ++latest.current;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`${endpoint}?q=${encodeURIComponent(q)}`);
        const result = (await response.json()) as { success?: boolean; members?: Suggestion[] };
        if (request !== latest.current) return; // a newer keystroke won
        setSuggestions(result.members ?? []);
        setActive(-1);
      } catch {
        if (request === latest.current) setSuggestions([]);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query, endpoint]);

  function pick(suggestion: Suggestion) {
    setOpen(false);
    if (onPick) {
      onPick(suggestion);
      setQuery("");
      return;
    }
    router.push(`/dashboard/memberships/${suggestion.id}`);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && onSubmitQuery && (active < 0 || !open)) {
      event.preventDefault();
      const value = query.trim();
      if (!value) return;
      latest.current += 1; // drop any search still in flight
      setOpen(false);
      setSuggestions([]);
      setQuery("");
      onSubmitQuery(value);
      return;
    }
    if (!open || suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (index + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
    } else if (event.key === "Enter" && active >= 0) {
      event.preventDefault();
      pick(suggestions[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  const showList = open && query.trim().length >= 2 && suggestions.length > 0;

  return (
    <form
      className={compact ? (onPick ? "relative w-full" : "relative w-full sm:w-64") : "relative flex max-w-xl gap-2"}
      action="/dashboard/memberships"
      onSubmit={(event) => {
        setOpen(false);
        if (onPick) event.preventDefault();
      }}
    >
      <div className="relative flex-1">
        <Input
          ref={inputRef}
          name="q"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? (compact ? "Find another member…" : "Member name or email")}
          aria-label={ariaLabel ?? "Member name or email"}
          autoComplete="off"
          autoFocus={autoFocus ?? !compact}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        />
        {showList ? (
          <ul
            id={listId}
            role="listbox"
            className="absolute top-full left-0 z-50 mt-1 max-h-96 w-full min-w-[min(24rem,90vw)] overflow-auto rounded-md border bg-popover py-1 shadow-lg"
          >
            {suggestions.map((suggestion, index) => (
              <li
                key={suggestion.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(suggestion);
                }}
                onMouseEnter={() => setActive(index)}
                className={`cursor-pointer px-3 py-2 text-sm ${index === active ? "bg-muted" : ""}`}
              >
                <span className="font-medium">{suggestion.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">{suggestion.status}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {suggestion.detail ?? (suggestion.plans.length ? suggestion.plans.join(", ") : onPick ? "" : "No current membership")}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {compact ? null : <Button type="submit">Search</Button>}
    </form>
  );
}
