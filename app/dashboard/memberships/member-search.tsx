"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Suggestion = { id: string; name: string; status: string; plans: string[] };

// Member search with a dropdown of matches as you type ("paige" lists every
// Paige). Pick one to open their page; Enter without a pick shows the full
// results list.
export function MemberSearch({ initialQuery }: { initialQuery: string }) {
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
        const response = await fetch(`/api/memberships/search?q=${encodeURIComponent(q)}`);
        const result = (await response.json()) as { success?: boolean; members?: Suggestion[] };
        if (request !== latest.current) return; // a newer keystroke won
        setSuggestions(result.members ?? []);
        setActive(-1);
      } catch {
        if (request === latest.current) setSuggestions([]);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  function pick(suggestion: Suggestion) {
    setOpen(false);
    router.push(`/dashboard/memberships/${suggestion.id}`);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
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
    <form className="relative flex max-w-xl gap-2" action="/dashboard/memberships" onSubmit={() => setOpen(false)}>
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
          placeholder="Member name or email"
          aria-label="Member name or email"
          autoComplete="off"
          autoFocus
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        />
        {showList ? (
          <ul id={listId} role="listbox" className="absolute top-full right-0 left-0 z-20 mt-1 max-h-80 overflow-auto rounded-md border bg-popover py-1 shadow-md">
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
                  {suggestion.plans.length ? suggestion.plans.join(", ") : "No current membership"}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <Button type="submit">Search</Button>
    </form>
  );
}
