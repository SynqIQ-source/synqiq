"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ListFilter, UserRound, Users } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const VIEWS = [
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Due today" },
  { value: "due", label: "Overdue + due today" },
  { value: "upcoming", label: "Upcoming" },
  { value: "all", label: "All open leads" },
];

const QUEUES = [
  { value: "all", label: "Visited or not" },
  { value: "lead", label: "Not visited yet" },
  { value: "visited", label: "Visited" },
];

export function FollowUpFilters({
  view,
  queue,
  seller,
  salespeople,
}: {
  view: string;
  queue: string;
  seller: string;
  // null for salespeople, who only see their own leads.
  salespeople: { id: string; name: string }[] | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setParam(name: "view" | "queue" | "seller", value: string, fallback: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === fallback) params.delete(name);
    else params.set(name, value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Select value={view} onValueChange={(value) => setParam("view", value, "overdue")}>
        <SelectTrigger aria-label="Show" className="min-w-[170px] bg-card">
          <span className="flex items-center gap-2">
            <ListFilter className="h-4 w-4 text-muted-foreground" />
            <SelectValue />
          </span>
        </SelectTrigger>
        <SelectContent align="end">
          {VIEWS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={queue} onValueChange={(value) => setParam("queue", value, "all")}>
        <SelectTrigger aria-label="Visited" className="min-w-[160px] bg-card">
          <span className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <SelectValue />
          </span>
        </SelectTrigger>
        <SelectContent align="end">
          {QUEUES.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {salespeople ? (
        <Select value={seller} onValueChange={(value) => setParam("seller", value, "all")}>
          <SelectTrigger aria-label="Salesperson" className="min-w-[170px] bg-card">
            <span className="flex items-center gap-2">
              <UserRound className="h-4 w-4 text-muted-foreground" />
              <SelectValue />
            </span>
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="all">Whole club</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            {salespeople.map((person) => (
              <SelectItem key={person.id} value={person.id}>
                {person.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}
