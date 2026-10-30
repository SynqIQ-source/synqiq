"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { UserRound } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function CalendarSellerSelect({
  seller,
  salespeople,
}: {
  seller: string;
  salespeople: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function choose(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") params.delete("seller");
    else params.set("seller", value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <Select value={seller} onValueChange={choose}>
      <SelectTrigger aria-label="Salesperson" className="min-w-[170px] bg-card">
        <span className="flex items-center gap-2">
          <UserRound className="h-4 w-4 text-muted-foreground" />
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value="all">Whole club</SelectItem>
        {salespeople.map((person) => (
          <SelectItem key={person.id} value={person.id}>
            {person.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
