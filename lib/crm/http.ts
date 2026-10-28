import { NextResponse } from "next/server";

// Shared response helpers for CRM routes. Error messages here are shown to
// staff or guests, so they never echo submitted values back, and server
// logs only ever get a route label plus a Postgres/Storage error code --
// never names, emails, phone numbers or other submitted data.

export function jsonError(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export function logCrmError(route: string, error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : error instanceof Error
        ? error.name
        : "unknown";
  console.error(`[crm] ${route} failed (${code})`);
}

// Reads a JSON body with a size cap (the check-in carries a photo and
// signature images, so it gets a larger cap than everything else).
export async function readJsonBody(request: Request, maxBytes = 32_000): Promise<Record<string, unknown> | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return null;
  const text = await request.text().catch(() => "");
  if (text.length === 0 || text.length > maxBytes) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
