import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { syncClients } from "@/lib/sync/clients";

// Thin wrapper -- see lib/sync/clients.ts for the actual sync logic, shared
// with app/api/sync/all/route.ts (the endpoint vercel.json's cron entries
// actually hit, to stay within Hobby's 2-cron-job cap). Kept as its own
// route so it's still individually callable by hand.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${getEnv("CRON_SECRET")}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await syncClients();

  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
