import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_FIELD_LENGTH = 200;

// Public, unauthenticated -- this is the /contact marketing page's lead
// form, submitted by visitors who have no Synq account at all. Not gated
// by middleware.ts (that only covers /dashboard/*). Re-validates
// server-side rather than trusting the client form's own checks, same as
// every other public-facing write in this app.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    const name: unknown = body?.name;
    const studioName: unknown = body?.studioName;
    const website: unknown = body?.website;
    const phone: unknown = body?.phone;
    const email: unknown = body?.email;

    if (typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Name is required." }, { status: 400 });
    }
    if (name.length > MAX_FIELD_LENGTH) {
      return NextResponse.json({ error: `Name must be ${MAX_FIELD_LENGTH} characters or fewer.` }, { status: 400 });
    }

    if (typeof studioName !== "string" || !studioName.trim()) {
      return NextResponse.json({ error: "Studio / Gym Name is required." }, { status: 400 });
    }
    if (studioName.length > MAX_FIELD_LENGTH) {
      return NextResponse.json(
        { error: `Studio / Gym Name must be ${MAX_FIELD_LENGTH} characters or fewer.` },
        { status: 400 },
      );
    }

    if (typeof email !== "string" || !email.trim() || !EMAIL_PATTERN.test(email.trim())) {
      return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
    }

    if (website !== null && website !== undefined && typeof website !== "string") {
      return NextResponse.json({ error: "Website must be a string." }, { status: 400 });
    }
    if (typeof website === "string" && website.length > MAX_FIELD_LENGTH) {
      return NextResponse.json({ error: `Website must be ${MAX_FIELD_LENGTH} characters or fewer.` }, { status: 400 });
    }

    if (phone !== null && phone !== undefined && typeof phone !== "string") {
      return NextResponse.json({ error: "Phone must be a string." }, { status: 400 });
    }
    if (typeof phone === "string" && phone.length > MAX_FIELD_LENGTH) {
      return NextResponse.json({ error: `Phone must be ${MAX_FIELD_LENGTH} characters or fewer.` }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();

    const { error } = await admin.from("leads").insert({
      name: name.trim(),
      studio_name: studioName.trim(),
      website: typeof website === "string" && website.trim() ? website.trim() : null,
      phone: typeof phone === "string" && phone.trim() ? phone.trim() : null,
      email: email.trim(),
    });

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
