import { NextRequest, NextResponse } from "next/server";
import { checkActivation, requestActivationLink, setMindbodyConnected } from "@/lib/mindbody/activation";
import { getPlatformAdmin } from "@/lib/platform/admin";
import { isUuid, jsonError, logCrmError, readJsonBody } from "@/lib/crm/http";

type RouteParams = { params: Promise<{ id: string }> };

// A studio's Mindbody connection (platform admins only). See
// lib/mindbody/activation.ts for the steps.
//   { action: "link" }        get the activation link to send the owner
//   { action: "check" }       has the owner approved it?
//   { action: "connect" }     start the nightly syncs (must be approved)
//   { action: "disconnect" }  stop them (data is kept)
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    if (!(await getPlatformAdmin())) return jsonError("Not found.", 404);
    const { id } = await params;
    if (!isUuid(id)) return jsonError("Studio not found.", 404);
    const body = await readJsonBody(request);
    const action = body?.action;

    if (action === "link") return NextResponse.json({ success: true, ...(await requestActivationLink(id)) });
    if (action === "check") return NextResponse.json({ success: true, status: await checkActivation(id) });
    if (action === "connect" || action === "disconnect") {
      return NextResponse.json({ success: true, status: await setMindbodyConnected(id, action === "connect") });
    }
    return jsonError("Invalid request.", 400);
  } catch (error) {
    logCrmError("platform/studios mindbody", error);
    return jsonError(error instanceof Error ? error.message : "Couldn't reach Mindbody.", 500);
  }
}
