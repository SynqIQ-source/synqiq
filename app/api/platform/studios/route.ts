import { NextRequest, NextResponse } from "next/server";
import { getOptionalEnv } from "@/lib/env";
import { getPlatformAdmin } from "@/lib/platform/admin";
import { createStudio, parseNewStudio, StudioError } from "@/lib/platform/studios";
import { jsonError, logCrmError, readJsonBody } from "@/lib/crm/http";
import { resolveRequestOrigin } from "@/lib/request-origin";

// Adds a studio and invites its owner (platform admins only).
export async function POST(request: NextRequest) {
  try {
    if (!(await getPlatformAdmin())) return jsonError("Not found.", 404);
    let studio;
    try {
      studio = parseNewStudio(await readJsonBody(request));
    } catch (error) {
      if (error instanceof StudioError) return jsonError(error.message, 400);
      throw error;
    }
    // NEXT_PUBLIC_SITE_URL for the same allow-list reason as
    // app/api/staff/[id]/invite/route.ts.
    const origin = getOptionalEnv("NEXT_PUBLIC_SITE_URL") ?? resolveRequestOrigin(request);
    try {
      const result = await createStudio(studio, `${origin}/auth/confirm`);
      return NextResponse.json({ success: true, ...result });
    } catch (error) {
      if (error instanceof StudioError) return jsonError(error.message, 409);
      throw error;
    }
  } catch (error) {
    logCrmError("platform/studios POST", error);
    return jsonError("Couldn't add the studio.", 500);
  }
}
