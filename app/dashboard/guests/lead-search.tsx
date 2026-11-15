"use client";

import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { MemberSearch } from "../memberships/member-search";

// Find any lead or guest by name, email or phone: matches drop down as you
// type (like check-in); pick one to open their page.
export function LeadSearch() {
  const router = useRouter();
  return (
    <div className="flex w-full max-w-md items-center gap-2">
      <Search className="size-4 shrink-0 text-muted-foreground" />
      <div className="w-full">
        <MemberSearch
          initialQuery=""
          endpoint="/api/crm/contacts/lookup"
          onPick={(lead) => router.push(`/dashboard/guests/${lead.id}`)}
          onSubmitQuery={() => undefined}
          placeholder="Find a lead: name, email or phone"
          ariaLabel="Find a lead"
          compact
        />
      </div>
    </div>
  );
}
