import { NextRequest, NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/current-staff";
import { canCheckIn } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { cleanQuery, rankMatch } from "@/lib/memberships/member-search";
import { normalizeCardCode } from "@/lib/checkin/card";

type Match = { id: string; name: string; status: string; plans: string[]; detail?: string; rank: number };

// Check-in search, one box: name, email, phone or key-card number. Anyone
// in the client list (members and guests with passes).
export async function GET(request: NextRequest) {
  const currentStaff = await getCurrentStaff();
  if (!currentStaff || !canCheckIn(currentStaff)) {
    return NextResponse.json({ success: false, error: "Not allowed." }, { status: 403 });
  }
  const raw = request.nextUrl.searchParams.get("q") ?? "";
  const admin = createSupabaseAdminClient();
  const orgId = currentStaff.organizationId;
  const matches = new Map<string, Match>();
  const add = (id: string | null, first: string, last: string, status: string, detail: string | undefined, rank: number) => {
    if (!id) return;
    const existing = matches.get(id);
    if (!existing || rank < existing.rank) matches.set(id, { id, name: `${first} ${last}`.trim(), status, plans: [], detail, rank });
  };
  const clientsByIds = async (ids: string[]) =>
    ids.length
      ? ((
          await admin
            .from("clients")
            .select("mindbody_client_id, first_name, last_name, status")
            .eq("organization_id", orgId)
            .in("mindbody_client_id", ids)
        ).data ?? [])
      : [];

  const digits = raw.replace(/\D/g, "");
  const looksNumeric = digits.length >= 4 && raw.replace(/[\d\s()+\-.]/g, "").length === 0;

  if (looksNumeric) {
    // Key-card / client ID: exact first, then IDs starting with what was typed.
    const code = normalizeCardCode(raw);
    const { data: byCode } = await admin
      .from("clients")
      .select("mindbody_client_id, first_name, last_name, status")
      .eq("organization_id", orgId)
      .or(`mindbody_client_id.eq.${code},mindbody_client_id.like.${code}%`)
      .limit(8);
    for (const row of byCode ?? [])
      add(
        row.mindbody_client_id,
        row.first_name,
        row.last_name,
        row.status,
        `Card ${row.mindbody_client_id}`,
        row.mindbody_client_id === code ? 0 : 3,
      );
    if (/^\d{1,10}$/.test(code)) {
      const { data: byUnique } = await admin
        .from("clients")
        .select("mindbody_client_id, first_name, last_name, status")
        .eq("organization_id", orgId)
        .eq("mindbody_unique_id", Number(code))
        .limit(1);
      for (const row of byUnique ?? []) add(row.mindbody_client_id, row.first_name, row.last_name, row.status, `Card ${code}`, 1);
    }
    // Phone (members' Mindbody phones, and guests' phones in the CRM).
    if (digits.length >= 4) {
      const [{ data: phones }, { data: contacts }] = await Promise.all([
        admin
          .from("member_personal")
          .select("mindbody_client_id")
          .eq("organization_id", orgId)
          .like("phone_digits", `%${digits}%`)
          .limit(10),
        admin
          .from("crm_contacts")
          .select("mindbody_client_id")
          .eq("organization_id", orgId)
          .not("mindbody_client_id", "is", null)
          .is("deleted_at", null)
          .like("phone_e164", `%${digits}%`)
          .limit(10),
      ]);
      const ids = [...new Set([...(phones ?? []), ...(contacts ?? [])].map((row) => row.mindbody_client_id as string))];
      for (const row of await clientsByIds(ids))
        add(row.mindbody_client_id, row.first_name, row.last_name, row.status, `Phone ··${digits.slice(-4)}`, 2);
    }
  } else {
    const query = cleanQuery(raw);
    if (query.length >= 2) {
      const words = query.split(" ");
      let search = admin
        .from("clients")
        .select("mindbody_client_id, first_name, last_name, email, status")
        .eq("organization_id", orgId)
        .not("mindbody_client_id", "is", null);
      search =
        words.length >= 2
          ? search.ilike("first_name", `${words[0]}%`).ilike("last_name", `${words.slice(1).join(" ")}%`)
          : search.or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,email.ilike.%${query}%`);
      const { data } = await search.limit(200);
      for (const row of data ?? []) {
        const rank = rankMatch({ firstName: row.first_name, lastName: row.last_name, email: row.email }, query);
        add(
          row.mindbody_client_id,
          row.first_name,
          row.last_name,
          row.status,
          rank === 3 ? (row.email ?? undefined) : undefined,
          10 + rank,
        );
      }
    }
  }

  const members = [...matches.values()]
    .sort((a, b) => a.rank - b.rank || (a.status === "Active" ? 0 : 1) - (b.status === "Active" ? 0 : 1) || a.name.localeCompare(b.name))
    .slice(0, 8)
    .map((member) => ({ id: member.id, name: member.name, status: member.status, plans: member.plans, detail: member.detail }));
  return NextResponse.json({ success: true, members });
}
