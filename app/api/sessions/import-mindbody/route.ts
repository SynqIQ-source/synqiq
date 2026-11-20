import { NextRequest, NextResponse } from "next/server";
import { isCronRequest } from "@/lib/cron-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { importMindbodyPacks } from "@/lib/sessions/packs";

export const maxDuration = 300;

// Cron (vercel.json, after the nightly member-profile pulls): refresh each
// studio's session packs from Mindbody's balances, until its switch date.
export async function GET(request: NextRequest) {
  if (!isCronRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: orgs } = await createSupabaseAdminClient().from("organizations").select("id").not("mindbody_site_id", "is", null);
  const results: Record<string, unknown> = {};
  for (const org of orgs ?? []) {
    try {
      results[org.id as string] = await importMindbodyPacks(org.id as string);
    } catch (error) {
      console.error("[session-packs] import failed:", error);
      results[org.id as string] = { error: true };
    }
  }
  return NextResponse.json({ success: true, results });
}
