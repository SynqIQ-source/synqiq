import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { canCheckIn } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { cleanQuery, rankMatch } from "@/lib/memberships/member-search";

// Check-in search: anyone in Mindbody's client list (members, and guests
// with passes); names starting with what was typed first, Active first.
export async function GET(request: NextRequest) {
  const currentStaff = await getCurrentStaff();
  if (!currentStaff || !canCheckIn(currentStaff)) {
    return NextResponse.json({ success: false, error: "Not allowed." }, { status: 403 });
  }
  const query = cleanQuery(request.nextUrl.searchParams.get("q") ?? "");
  if (query.length < 2) return NextResponse.json({ success: true, members: [] });
  const words = query.split(" ");
  let search = createSupabaseAdminClient()
    .from("clients")
    .select("mindbody_client_id, first_name, last_name, email, status")
    .eq("organization_id", currentStaff.organizationId)
    .not("mindbody_client_id", "is", null);
  search =
    words.length >= 2
      ? search.ilike("first_name", `${words[0]}%`).ilike("last_name", `${words.slice(1).join(" ")}%`)
      : search.or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,email.ilike.%${query}%`);
  const { data } = await search.limit(200);
  const members = (data ?? [])
    .map((row) => ({
      id: row.mindbody_client_id as string,
      firstName: row.first_name as string,
      lastName: row.last_name as string,
      email: row.email as string | null,
      status: row.status as string,
    }))
    .sort(
      (a, b) =>
        rankMatch(a, query) - rankMatch(b, query) ||
        (a.status === "Active" ? 0 : 1) - (b.status === "Active" ? 0 : 1) ||
        a.firstName.localeCompare(b.firstName),
    )
    .slice(0, 8)
    .map((member) => ({
      id: member.id,
      name: `${member.firstName} ${member.lastName}`.trim(),
      status: member.status,
      plans: [] as string[],
    }));
  return NextResponse.json({ success: true, members });
}
