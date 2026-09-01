import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentStaff } from "@/lib/current-staff";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveRequestOrigin } from "@/lib/request-origin";
import { getEnv, getOptionalEnv } from "@/lib/env";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type RouteParams = { params: Promise<{ id: string }> };

// Send a password-reset email to a staff member who ALREADY has a linked
// login, optionally changing that login's email address first (e.g. after
// their email changed in Mindbody). This is the path for an existing
// account -- unlike app/api/staff/[id]/invite/route.ts, it never creates a
// new auth user, so it doesn't hit "a user with this email is already
// registered" and doesn't orphan the existing account. Admin client for
// the privileged bits, same auth-boundary reasoning as the invite route
// (the `staff` table has no UPDATE RLS policy; the role check here is the
// real gate).
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: staffId } = await params;
    const currentStaff = await getCurrentStaff();

    if (!currentStaff || currentStaff.role !== "admin") {
      return NextResponse.json(
        { success: false, error: "Only an authenticated admin can send a password reset." },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const emailOverride: unknown = body?.email;

    const admin = createSupabaseAdminClient();

    const { data: targetStaff, error: staffError } = await admin
      .from("staff")
      .select("id, organization_id, display_name, email, auth_user_id")
      .eq("id", staffId)
      .maybeSingle();

    if (
      staffError ||
      !targetStaff ||
      targetStaff.organization_id !== currentStaff.organizationId
    ) {
      return NextResponse.json({ success: false, error: "Staff member not found." }, { status: 404 });
    }

    if (!targetStaff.auth_user_id) {
      return NextResponse.json(
        {
          success: false,
          error: `${targetStaff.display_name} isn't linked to a login yet -- send an invite instead.`,
        },
        { status: 409 },
      );
    }

    const desiredEmail =
      typeof emailOverride === "string" && emailOverride.trim()
        ? emailOverride.trim()
        : targetStaff.email;

    if (!desiredEmail || !EMAIL_PATTERN.test(desiredEmail)) {
      return NextResponse.json(
        { success: false, error: "A valid email address is required." },
        { status: 400 },
      );
    }

    const { data: authUser, error: getUserError } = await admin.auth.admin.getUserById(
      targetStaff.auth_user_id,
    );

    if (getUserError || !authUser?.user) {
      return NextResponse.json(
        {
          success: false,
          error: "This staff member's linked login no longer exists -- re-invite them.",
        },
        { status: 409 },
      );
    }

    const currentEmail = authUser.user.email ?? "";
    const emailChanged = currentEmail.toLowerCase() !== desiredEmail.toLowerCase();

    if (emailChanged) {
      // email_confirm: true -- an admin changing this on a staff member's
      // behalf is an authoritative change, not a self-serve one; skip the
      // confirm-old + confirm-new round trip. The reset email that follows
      // is itself proof the new address is reachable.
      const { error: updateError } = await admin.auth.admin.updateUserById(targetStaff.auth_user_id, {
        email: desiredEmail,
        email_confirm: true,
      });

      if (updateError) {
        const alreadyTaken = /already been registered|already registered|email address is already/i.test(
          updateError.message,
        );
        return NextResponse.json(
          {
            success: false,
            error: alreadyTaken
              ? `${desiredEmail} already belongs to a different login. Reset that account from its own owner, or unlink it first.`
              : `Couldn't update the login email: ${updateError.message}`,
          },
          { status: alreadyTaken ? 409 : 502 },
        );
      }

      const { error: staffUpdateError } = await admin
        .from("staff")
        .update({ email: desiredEmail })
        .eq("id", staffId);

      if (staffUpdateError) {
        throw new Error(staffUpdateError.message);
      }
    }

    // Same redirectTo reasoning as the invite route and /forgot-password:
    // NEXT_PUBLIC_SITE_URL (synqiq.co, the address in Supabase's Redirect
    // URLs allow list), not the request origin (www.synqiq.co). Anon client
    // on purpose -- resetPasswordForEmail is a public auth call and GoTrue's
    // mailer only fires on that path, not on admin.generateLink.
    const origin = getOptionalEnv("NEXT_PUBLIC_SITE_URL") ?? resolveRequestOrigin(request);
    const anon = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: resetError } = await anon.auth.resetPasswordForEmail(desiredEmail, {
      redirectTo: `${origin}/auth/confirm`,
    });

    if (resetError) {
      return NextResponse.json(
        {
          success: false,
          // The email may already be changed at this point -- say so, so the
          // admin knows the state and can just retry the send.
          error: emailChanged
            ? `Login email updated to ${desiredEmail}, but sending the reset failed: ${resetError.message}. Try "Send password reset" again.`
            : `Couldn't send the reset email: ${resetError.message}`,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({ success: true, email: desiredEmail, emailChanged });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
