import { NextRequest, NextResponse } from "next/server";
import { isCronRequest } from "@/lib/cron-auth";
import { refreshDemoStudio } from "@/lib/demo/generate";

// Nightly top-up of the Demo Studio (lib/demo/generate.ts). Only ever adds
// rows to the demo studio; never touches a real studio.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ success: true, ...(await refreshDemoStudio()) });
  } catch (error) {
    console.error("[demo/refresh]", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Demo refresh failed." },
      { status: 500 },
    );
  }
}
